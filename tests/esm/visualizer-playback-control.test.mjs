import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultLayout, createItem, normalizeParams, normalizeLayout, encodeLayoutShare, decodeLayoutShare,
    PLAYBACK_ACTIONS, PLAYBACK_APPEARANCES } from '../../js/visualizer/visualizer-model.js';
import { playbackControlContains } from '../../js/visualizer/visualizer-playback-control.js';

test('Playback controls preserve actions, appearance and shared styling in layouts and shares', () => {
    const items = PLAYBACK_ACTIONS.map(action => {
        const item = createItem('playback-control', action);
        Object.assign(item.params, PLAYBACK_APPEARANCES.raised, { action, display: 'icon-label', label: 'Listen' });
        Object.assign(item.style, { fontFamily: 'serif', fontSize: 24, bold: true });
        item.effects = [{ type: 'glow', enabled: true, amount: .4 }];
        return item;
    });
    const layout = normalizeLayout({ ...createDefaultLayout(), items });
    assert.deepEqual(decodeLayoutShare(encodeLayoutShare(layout)).items, layout.items);
    assert.deepEqual(layout.items.map(item => item.params.action), PLAYBACK_ACTIONS);
    assert.ok(layout.items.every(item => item.style.bold && item.params.label === 'Listen'));
    assert.ok(layout.items.every(item => item.rect.w === .1 && item.rect.h === .14));
    const normalized = normalizeParams('playback-control', { action: 'unsafe', shape: 'bad', fill: 'url(test)', iconSize: 300, borderWidth: -2, label: 'a\nb' });
    assert.equal(normalized.action, 'play-pause');
    assert.equal(normalized.shape, 'rectangle');
    assert.equal(normalized.iconSize, 85);
    assert.equal(normalized.borderWidth, 0);
    assert.equal(normalized.label, 'a b');
    assert.match(normalized.fill, /^#[0-9a-f]{6}$/i);
});

test('Playback hit shapes exclude empty ellipse and rounded corners', () => {
    const bounds = { left: 0, top: 0, right: 100, bottom: 50, radius: 20, ellipse: false };
    assert.equal(playbackControlContains(bounds, { x: 0, y: 0 }), false);
    assert.equal(playbackControlContains(bounds, { x: 50, y: 25 }), true);
    bounds.ellipse = true;
    assert.equal(playbackControlContains(bounds, { x: 5, y: 5 }), false);
    assert.equal(playbackControlContains(bounds, { x: 50, y: 1 }), true);
});

test('Seek Bar appearance normalizes and round-trips through layout sharing', () => {
    const item = createItem('seek-bar', 'seek');
    assert.equal(item.params.thumbShape, 'circle');
    assert.equal(item.params.thumbBorderWidth, 0);
    assert.equal(item.params.thumbBorderColor, '#182331');
    item.params = normalizeParams('seek-bar', { thickness: 100, thumbSize: -1, trackColor: 'invalid', showThumb: false,
        thumbShape: 'invalid', thumbBorderWidth: 100, thumbBorderColor: 'invalid' });
    assert.equal(item.params.thickness, 40);
    assert.equal(item.params.thumbSize, 6);
    assert.equal(item.params.trackColor, '#71859b');
    assert.equal(item.params.thumbShape, 'circle');
    assert.equal(item.params.thumbBorderWidth, 8);
    assert.equal(item.params.thumbBorderColor, '#182331');
    assert.equal(normalizeParams('seek-bar', { thumbBorderWidth: -1 }).thumbBorderWidth, 0);
    assert.equal(normalizeParams('seek-bar', { thumbBorderWidth: 2.3 }).thumbBorderWidth, 2.5);
    for (const thumbShape of ['circle', 'square', 'diamond', 'bar']) {
        Object.assign(item.params, { thumbShape, thumbBorderWidth: 1.5, thumbBorderColor: '#234567' });
        const layout = normalizeLayout({ ...createDefaultLayout(), items: [item] });
        assert.deepEqual(decodeLayoutShare(encodeLayoutShare(layout)).items, layout.items);
    }
});
