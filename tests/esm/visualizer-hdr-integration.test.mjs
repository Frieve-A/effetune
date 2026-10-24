import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { VisualizerFeed } from '../../js/visualizer/visualizer-feed.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('Applying the Config HDR preference updates the existing Visualizer and Clean Feed', () => {
    const calls = [];
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        hdr: false,
        renderer: { setHdrEnabled: enabled => calls.push(['main', enabled]) },
        feed: { renderer: { setHdrEnabled: enabled => calls.push(['feed', enabled]) } }
    });
    view.setHdrEnabled(true);
    assert.equal(view.hdr, true);
    view.setHdrEnabled(false);
    assert.equal(view.hdr, false);
    assert.deepEqual(calls, [['main', true], ['feed', true], ['main', false], ['feed', false]]);
});

test('Visualizer shares compatible Clean Feed compositions and renders independently for mixed displays', async () => {
    const calls = [], sharedVideo = {}, layout = { aspect: '16:9', items: [] };
    let compatible = true, status = 'ready', rendered;
    const feedRenderer = {};
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        visible: true, hdr: true, quality: 'high', layout, uiManager: {},
        stageHost: { getBoundingClientRect: () => ({ width: 640, height: 360 }), classList: { contains: () => false } },
        stage: { style: {} }, canvas: { width: 640, height: 360 }, status: {}, editor: { open: false },
        sources: { getStatus: () => status },
        feed: { visible: true, canvas: { width: 1280, height: 720 }, renderer: feedRenderer },
        renderer: {
            quality: 0,
            copyFrom(source, options) { calls.push(['copy', source, options.hdr]); return compatible; },
            draw(_layout, _sources, _metadata, _time, options) { calls.push(['draw', options.hdr, options.video]); rendered = options; },
            clear() { calls.push(['clear']); }
        },
        metadata: () => null, lyrics: () => null, videoFrame: () => sharedVideo, counters: () => new Map(), t: (_key, fallback) => fallback
    });
    await withGlobals({ document: { body: { style: {}, classList: { contains: () => false } } },
        window: { devicePixelRatio: 1 }, requestAnimationFrame: () => 1 }, () => {
        view.frame(0);
        assert.deepEqual(calls, [['copy', feedRenderer, true]]);
        assert.deepEqual([view.canvas.width, view.canvas.height], [1280, 720]);
        calls.length = 0;
        view.editor.open = true;
        view.frame(8);
        assert.deepEqual(calls, [['draw', true, sharedVideo]], 'Edit must render its own previews even with a compatible visible feed');
        assert.equal(rendered.editing, true);
        assert.equal(rendered.playback.available, false, 'Absent player must still reach the Edit renderer');
        assert.deepEqual([view.canvas.width, view.canvas.height], [640, 360]);
        view.editor.open = false;
        calls.length = 0;
        compatible = false;
        view.frame(16);
        assert.deepEqual(calls, [['copy', feedRenderer, true], ['draw', true, sharedVideo]]);
        calls.length = 0;
        view.hdr = false;
        view.frame(32);
        assert.deepEqual(calls, [['copy', feedRenderer, false], ['draw', false, sharedVideo]]);
        calls.length = 0;
        status = 'unavailable';
        view.frame(48);
        assert.deepEqual(calls, [['clear']]);
        assert.equal(view.status.hidden, false);
    });
});

test('Clean Feed follows the shared HDR preference and clears and disposes its output', () => {
    const calls = [], video = {}, canvas = { style: {}, width: 1, height: 1 };
    let status = 'ready';
    const view = { hdr: true, quality: 'high', layout: { aspect: '16:9', items: [] },
        sources: { getStatus: () => status }, metadata: () => null, lyrics: () => null,
        videoFrame: () => video, counters: () => new Map(), playback: () => ({}), syncPlaybackControls() {} };
    const feed = Object.assign(Object.create(VisualizerFeed.prototype), {
        view, visible: true, canvas, hdrCanvas: { style: {} },
        window: { closed: false, innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
            requestAnimationFrame: () => 9, cancelAnimationFrame: id => calls.push(['cancel', id]), close() { this.closed = true; } },
        renderer: { quality: 0,
            draw(_layout, _sources, _metadata, _time, options) { calls.push(['draw', options.hdr, options.video]); },
            clear() { calls.push(['clear']); }, dispose() { calls.push(['dispose']); }
        }
    });
    feed.frame(0);
    view.hdr = false;
    feed.frame(16);
    assert.deepEqual(calls, [['draw', true, video], ['draw', false, video]]);
    assert.deepEqual(feed.hdrCanvas.style, canvas.style);
    assert.deepEqual([canvas.width, canvas.height], [1920, 1080]);
    status = 'unavailable';
    feed.frame(32);
    feed.dispose();
    assert.deepEqual(calls.slice(2), [['clear'], ['cancel', 9], ['dispose']]);
    assert.equal(feed.closed, true);
});

test('Main-window hit tests use its own presented frame while Clean Feed is visible', () => {
    const calls = [];
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        layout: {}, hasLyrics: true, editor: { open: false },
        canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
        renderer: { counterAt: () => { calls.push('counter'); return 'clock'; }, lyricsSeekTime: () => { calls.push('lyrics'); return 12; } },
        feed: { visible: true, renderer: {} }, counters: () => new Map([['clock', { external: true }]])
    });
    const event = { clientX: 20, clientY: 30, target: {} };
    assert.equal(view.counterAt(event), 'clock');
    assert.equal(view.lyricsSeekTime(event), 12);
    assert.deepEqual(calls, ['counter', 'lyrics']);
});
