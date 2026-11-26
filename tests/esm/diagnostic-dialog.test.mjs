import assert from 'node:assert/strict';
import test from 'node:test';
import { openDiagnosticDialog } from '../../js/diagnostics/diagnostic-dialog.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';

function dialogFixture(host = {}) {
    const doc = createFakeDocument();
    const create = doc.createElement;
    doc.createElement = tag => {
        const node = create.call(doc, tag);
        node.focus = () => { doc.activeElement = node; };
        node.append = (...nodes) => nodes.forEach(child => node.appendChild(child));
        node.remove = () => node.parentNode?.removeChild(node);
        node.click = () => node.dispatchEvent('click');
        return node;
    };
    const timers = new Map();
    const win = { document: doc, setInterval: callback => { timers.set(1, callback); return 1; },
        clearInterval: id => timers.delete(id), ...host };
    const file = { name: 'effetune-diagnostics-20261122-110523.txt', text: '{\n  "example": "♪"\n}',
        summary: 'System\n  OS: Windows' };
    return { win, file, timers, open: async options => {
        let collections = 0;
        await openDiagnosticDialog({ win, collect: () => { collections++; return file; },
            translate: key => key, ...options });
        assert.equal(collections, 1);
        const find = predicate => doc.allElements.find(predicate);
        const preview = find(node => node.tagName === 'PRE');
        const details = find(node => node.tagName === 'DETAILS');
        assert.ok(!details.open);
        assert.equal(preview.textContent, file.text);
        assert.equal(find(node => node.className === 'diagnostic-summary').textContent, file.summary);
        return { save: find(node => node.textContent === 'browser.save'),
            close: find(node => node.textContent === 'backupRestore.action.close'),
            overview: find(node => node.className === 'diagnostic-summary'),
            status: find(node => node.getAttribute('role') === 'status'), preview };
    } };
}

test('Electron writes the previewed text once, handles cancellation and reports write failure', async t => {
    t.mock.method(console, 'error', () => {});
    let result = { canceled: true };
    let ok = true;
    const writes = [];
    const api = { showSaveDialog: async () => result,
        saveFile: async (path, text) => { writes.push([path, text]); return { success: ok }; } };
    const { open } = dialogFixture({ electronAPI: api });
    const { save, status, preview } = await open();
    await save.click();
    assert.deepEqual(writes, []);
    assert.equal(status.textContent, '');
    result = { canceled: false, filePath: 'chosen.txt' };
    await save.click();
    assert.deepEqual(writes, [['chosen.txt', preview.textContent]]);
    assert.equal(status.textContent, 'diagnostics.saved');
    ok = false;
    await save.click();
    assert.equal(status.textContent, 'error.fileExportFailed');
});

test('Android saves the previewed bytes via Documents and distinguishes cancellation from failure', async t => {
    t.mock.method(console, 'error', () => {});
    let errorName = 'AbortError';
    let written;
    const { open, file } = dialogFixture({ location: { origin: 'https://appassets.androidplatform.net' },
        effetuneAndroid: { postMessage() {} } });
    const { save, status, preview } = await open({ androidDocuments: {
        async pick(options) {
            assert.deepEqual(options, { kind: 'save', name: file.name, mimeType: 'text/plain' });
            if (errorName) throw Object.assign(new Error(), { name: errorName });
            return { uri: 'chosen' };
        },
        async write(uri, blob) { assert.equal(uri, 'chosen'); written = await blob.text(); }
    } });
    await save.click();
    assert.equal(status.textContent, '');
    assert.equal(written, undefined);
    errorName = '';
    await save.click();
    assert.equal(written, preview.textContent);
    assert.equal(status.textContent, 'diagnostics.saved');
    errorName = 'NotAllowedError';
    await save.click();
    assert.equal(status.textContent, 'error.fileExportFailed');
});

test('Web download uses the preview bytes and reports that the download started', async t => {
    let blob;
    t.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:diagnostic'; });
    const revoked = t.mock.method(URL, 'revokeObjectURL', () => {});
    const { win, file, open } = dialogFixture();
    const { save, status, preview } = await open();
    await save.click();
    assert.equal(status.textContent, 'diagnostics.download');
    assert.equal(await blob.text(), preview.textContent);
    assert.equal(win.document.allElements.find(node => node.tagName === 'A').download, file.name);
    assert.equal(revoked.mock.calls[0].arguments[0], 'blob:diagnostic');
});

test('the overview follows the latest summary while open and the preview keeps the collected file', async () => {
    const { file, timers, open } = dialogFixture();
    const { overview, preview, close } = await open();
    const latest = { ...file, text: '{}', summary: 'Input clock offset: +3.2 ppm' };
    Object.assign(file, latest);
    await timers.get(1)();
    assert.equal(overview.textContent, latest.summary);
    assert.notEqual(preview.textContent, latest.text);
    close.click();
    assert.equal(timers.size, 0);
});
