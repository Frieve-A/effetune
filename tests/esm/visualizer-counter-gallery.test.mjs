import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { VisualizerEditor } from '../../js/visualizer/visualizer-editor.js';
import { counterFrame } from '../../js/visualizer/visualizer-counter.js';
import { createDefaultLayout, encodeLayoutShare, decodeLayoutShare, snapshotLayout, validateLayout } from '../../js/visualizer/visualizer-model.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

const gallery = JSON.parse(readFileSync(new URL('../../presets/visualizer/16x9.json', import.meta.url)))['Counter Gallery'];

test('Counter Gallery is a valid shared layout with eight live displays and a frame example', () => {
    assert.equal(validateLayout(gallery), true);
    assert.deepEqual(decodeLayoutShare(encodeLayoutShare(gallery)), snapshotLayout(gallery));
    const counters = gallery.items.filter(item => item.type === 'counter');
    assert.equal(counters.length, 8);
    assert.equal(counters.filter(item => item.params.counterSubsecond === 'frames').length, 1);
    for (const item of counters) {
        assert.notEqual(counterFrame(item.params, 12.25).text, counterFrame(item.params, 13.75).text);
        assert.ok(item.effects.some(effect => effect.type === 'backplate'));
        assert.ok(item.rect.x >= 0 && item.rect.y >= 0);
        assert.ok(item.rect.x + item.rect.w <= 1 && item.rect.y + item.rect.h <= 1);
    }
});

test('each Gallery Counter keeps its complete appearance when copied into another layout', async () => {
    let clipboard = '';
    await withGlobals({ window: { electronAPI: { writeClipboardText(text) { clipboard = text; return true; } } } }, async () => {
        for (const item of gallery.items.filter(entry => entry.type === 'counter')) {
            const source = Object.assign(Object.create(VisualizerEditor.prototype), {
                view: { layout: gallery, uiManager: { showTransientMessage() {} } },
                selection: new Set([item.id]), t: (_key, fallback) => fallback
            });
            assert.equal(await source.copySelected(), true);
            const target = Object.assign(Object.create(VisualizerEditor.prototype), {
                view: { layout: { ...createDefaultLayout(), items: [] } },
                selection: new Set(), gridStep: () => 0.01, changed() {}
            });
            assert.equal(target.pasteItems(clipboard), true);
            const [copy] = target.view.layout.items;
            assert.notEqual(copy.id, item.id);
            for (const key of ['type', 'params', 'style', 'palette', 'effects']) assert.deepEqual(copy[key], item[key]);
            assert.equal(copy.rect.w, item.rect.w);
            assert.equal(copy.rect.h, item.rect.h);
        }
    });
});
