import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildExtension } from '../../scripts/build-extension.mjs';

const repositoryRoot = new URL('../../', import.meta.url);
const zipModule = { exports: {} };
vm.runInNewContext(await readFile(new URL('js/vendor/jszip-3.10.2.min.js', repositoryRoot), 'utf8'),
    { module: zipModule, exports: zipModule.exports, setImmediate, Buffer, Uint8Array, ArrayBuffer });
const JSZip = zipModule.exports;

test('browser extension ships vendor and DSP notices and preserves legal comments', async () => {
    const result = await buildExtension();
    const archive = await new JSZip().loadAsync(await readFile(result.archive));
    for (const filename of [
        'LICENSE',
        'plugins/dsp/NOTICE.txt',
        'js/vendor/jszip-3.10.2.NOTICE.txt',
        'js/vendor/offline-audio-encoders.NOTICE.txt'
    ]) {
        const entry = archive.file(filename);
        assert.ok(entry, `Extension archive is missing ${filename}`);
        assert.deepEqual(await entry.async('nodebuffer'), await readFile(new URL(filename, repositoryRoot)));
    }
    const jszip = await archive.file('js/vendor/jszip-3.10.2.min.js').async('string');
    assert.ok(jszip.includes('JSZip v3.10.2'));
    const encoders = await archive.file('js/vendor/offline-audio-encoders.mjs').async('string');
    assert.ok(encoders.includes('Copyright'));
    assert.ok(encoders.includes('This Source Code Form'));
    assert.ok(encoders.includes('https://mozilla.org/MPL/2.0/'));
});
