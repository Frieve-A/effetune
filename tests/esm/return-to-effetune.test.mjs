import assert from 'node:assert/strict';
import test from 'node:test';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { returnToEffeTune } from '../../features/measurement/return-to-effetune.js';

function createWindow(origin) {
    const calls = [];
    return {
        calls,
        effetuneAndroid: { postMessage() {} },
        location: {
            origin,
            href: `${origin}/features/measurement/measurement.html`,
            replace(url) { calls.push(['replace', url]); }
        },
        history: { length: 2, back() { calls.push(['back']); } },
        navigation: {
            currentEntry: { index: 1 },
            entries: () => [
                { url: `${origin}/effetune.html` },
                { url: `${origin}/features/measurement/measurement.html` }
            ]
        },
        sessionStorage: {
            values: new Map(),
            getItem(key) { return this.values.get(key) ?? null; },
            setItem(key, value) { this.values.set(key, value); },
            removeItem(key) { this.values.delete(key); }
        }
    };
}

test('Android returns through history when the EffeTune page is immediately behind it', async () => {
    const win = createWindow('https://appassets.androidplatform.net');
    await withGlobals({ window: win, document: { referrer: '' } }, () => returnToEffeTune('../../effetune.html'));
    assert.deepEqual(win.calls, [['back']]);
});

test('Android replaces a direct feature visit and restores the transient pipeline', async () => {
    const win = createWindow('https://appassets.androidplatform.net');
    win.history.length = 1;
    win.sessionStorage.setItem('effetune_transient_pipeline_state', '{}');
    await withGlobals({ window: win, document: { referrer: '' } }, () => returnToEffeTune('../../effetune.html'));
    assert.deepEqual(win.calls, [['replace', 'https://appassets.androidplatform.net/effetune.html?restorePipeline=transient']]);
    assert.equal(win.sessionStorage.getItem('effetune_feature_return_tab'), 'effects');
});

test('Web returns from measurement and benchmark while preserving feature history', async () => {
    for (const [page, mainPath] of [
        ['features/measurement/measurement.html', '../../effetune.html'],
        ['features/effetune_bench.html', '../effetune.html']
    ]) {
        const win = createWindow('https://example.test');
        win.location.href = `https://example.test/${page}`;
        win.sessionStorage.setItem('effetune_transient_pipeline_state', '{}');
        win.sessionStorage.setItem('effetune_feature_return_tab', 'player');
        await withGlobals({ window: win, document: { referrer: '' } }, () => returnToEffeTune(mainPath));
        assert.deepEqual(win.calls, []);
        assert.equal(win.location.href, 'https://example.test/effetune.html?restorePipeline=transient');
        assert.equal(win.sessionStorage.getItem('effetune_feature_return_tab'), 'player');
    }
});
