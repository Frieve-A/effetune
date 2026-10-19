import assert from 'node:assert/strict';
import test from 'node:test';
import { counterFrame } from '../../js/visualizer/visualizer-counter.js';
import { createDefaultLayout, createItem, normalizeParams, encodeLayoutShare, decodeLayoutShare } from '../../js/visualizer/visualizer-model.js';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { VisualizerFeed } from '../../js/visualizer/visualizer-feed.js';

test('Counter formats selected fields, elapsed units, playlist ordinals and decimal precision', () => {
    const params = normalizeParams('counter', {});
    assert.equal(counterFrame(params, 3661.234).text, '01:01:01.234');
    assert.equal(counterFrame(params, 360000).text, '100:00:00.000');
    assert.equal(counterFrame({ ...params, counterHours: false }, 3661.234).text, '61:01.234');
    assert.equal(counterFrame({ ...params, counterHours: false, counterMinutes: false }, 3661.234).text, '3661.234');
    assert.equal(counterFrame({ ...params, counterFraction: false }, 59.999).text, '00:00:59');
    for (const [counterDigits, suffix] of [[1, '2'], [2, '23'], [3, '234'], [4, '2345']]) {
        assert.equal(counterFrame({ ...params, counterDigits }, 1.23456).text, `00:00:01.${suffix}`);
    }
    const custom = { ...params, counterIndex: true, counterTimeSeparator: '-', counterFractionSeparator: ',', counterIndexSeparator: ' / ' };
    assert.equal(counterFrame(custom, 1.234, 7).text, '07 / 00-00-01,234');
    assert.equal(counterFrame(custom, 0, 0).text, '00 / 00-00-00,000');
    assert.equal(counterFrame({ ...custom, counterTimeSeparator: '', counterFractionSeparator: '', counterIndexSeparator: '' }, 1.234, 12).text, '12000001234');
});

test('Counter tape rolls carrying digits together across a minute boundary', () => {
    const params = { ...normalizeParams('counter', {}), counterMotion: 'tape' };
    const frame = counterFrame(params, 59.9995);
    assert.equal(frame.text, '00:00:59.999');
    const digits = frame.tokens.filter(token => token.next !== undefined);
    assert.equal(digits.slice(3).map(token => token.next).join(''), '100000');
    assert.ok(digits.slice(0, 3).every(token => token.progress === 0));
    assert.ok(digits.slice(3).every(token => Math.abs(token.progress - 0.5) < 1e-6));
    for (const [time, text] of [[60, '00:01:00.000'], [3600, '01:00:00.000']]) {
        const exact = counterFrame(params, time);
        assert.equal(exact.text, text);
        assert.ok(exact.tokens.every(token => !token.progress));
    }
    const wholeSeconds = counterFrame({ ...params, counterFraction: false }, 59.5);
    assert.ok(wholeSeconds.tokens.some(token => token.text === '5' && token.next === '0' && token.progress === 0.5));
    const indexed = counterFrame({ ...params, counterIndex: true }, 59.9995, 99);
    assert.ok(indexed.tokens.slice(0, 2).every(token => !token.progress));
    assert.ok(counterFrame({ ...params, counterMotion: 'static' }, 59.9995).tokens.every(token => !token.progress));
});

test('Counter options survive shared layouts with bounded precision and optional separators', () => {
    const item = createItem('counter', 'clock');
    assert.equal(item.params.counterIndex, false);
    assert.equal(item.params.counterDigits, 3);
    item.params = normalizeParams('counter', { counterIndex: true, counterHours: false, counterMinutes: false,
        counterSeconds: true, counterFraction: false, counterDigits: 4, counterMotion: 'tape', counterBoxes: true,
        counterTimeSeparator: '', counterFractionSeparator: ',', counterIndexSeparator: ' | ' });
    const layout = { ...createDefaultLayout(), items: [item] };
    assert.deepEqual(decodeLayoutShare(encodeLayoutShare(layout)).items[0], item);
    assert.equal(normalizeParams('counter', { counterDigits: 0 }).counterDigits, 1);
    assert.equal(normalizeParams('counter', { counterDigits: 10 }).counterDigits, 4);
});

function counterView(player = null) {
    return Object.assign(Object.create(VisualizerView.prototype), {
        layout: { ...createDefaultLayout(), items: [createItem('counter', 'first'), createItem('counter', 'second')] },
        counterOrigins: new Map(),
        uiManager: { audioPlayer: player },
        editor: { open: false }
    });
}

test('Counter follows the live player, paused seeks, playlist changes and closed player UI', () => {
    const snapshot = { currentTrack: {}, currentTrackIndex: 6, currentTrackPosition: 3,
        currentTrackDuration: 30, isPlaying: true, isStopped: false, playbackSpeed: 1.5 };
    let livePosition = 12.25, liveReads = 0;
    const player = { ui: { container: {} }, stateManager: { getStateSnapshot: () => snapshot },
        contextManager: { getCurrentPlaybackTime() { liveReads++; return livePosition; } } };
    const view = counterView(player);
    assert.deepEqual(view.counters(1000).get('first'), { time: 12.25, trackIndex: 7, external: false,
        playing: true, speed: 1.5, source: snapshot.currentTrack, stamp: 1 });
    snapshot.isPlaying = false;
    assert.equal(view.counters(2000).get('first').time, 3);
    assert.equal(liveReads, 1);
    snapshot.currentTrackPosition = 20;
    assert.equal(view.counters(3000).get('first').time, 20);
    snapshot.currentTrackIndex = 100;
    snapshot.currentTrackPosition = 0;
    snapshot.isStopped = true;
    assert.deepEqual(view.counters(4000).get('first'), { time: 0, trackIndex: 101, external: false,
        playing: false, speed: 1.5, source: snapshot.currentTrack, stamp: 4 });
    snapshot.isStopped = false;
    snapshot.isPlaying = true;
    livePosition = 4;
    assert.equal(view.counters(5000).get('first').time, 4);
    assert.equal(view.resetCounter('first', 5000), false);
    const readsBeforeClose = liveReads;
    player.ui.container = null;
    assert.equal(view.counters(6000).get('first').external, true);
    assert.equal(view.counters(6000).get('first').trackIndex, 0);
    assert.equal(liveReads, readsBeforeClose);
});

test('External counters keep elapsed time through hidden frames and reset independently', () => {
    const view = counterView();
    assert.equal(view.counters(1000).get('first').time, 0);
    assert.equal(view.counters(11000).get('first').time, 10);
    assert.equal(view.counters(11000).get('first').trackIndex, 0);
    assert.equal(view.resetCounter('first', 12000), true);
    assert.equal(view.counters(13000).get('first').time, 1);
    assert.equal(view.counters(13000).get('second').time, 12);
    assert.equal(view.counters(73000).get('first').time, 61);
});

test('Clean Feed uses the same Counter descriptors as the main view', () => {
    const counters = new Map([['first', { time: 14.5, trackIndex: 0, external: true }]]);
    let rendered;
    const feed = Object.assign(Object.create(VisualizerFeed.prototype), {
        visible: true, canvas: { style: {}, width: 128, height: 72 }, hdrCanvas: { style: {} },
        window: { closed: false, innerWidth: 128, innerHeight: 72, devicePixelRatio: 1, requestAnimationFrame: () => 1 },
        view: { layout: { aspect: '16:9' }, sources: { getStatus: () => 'ready' }, metadata: () => null,
            lyrics: () => null, counters: () => counters, quality: 'auto', videoFrame: () => null },
        renderer: { draw(...args) { rendered = args; } }
    });
    feed.frame(1000);
    assert.equal(rendered[4].counters, counters);
});
