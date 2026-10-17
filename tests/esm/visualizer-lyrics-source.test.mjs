import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { VisualizerFeed } from '../../js/visualizer/visualizer-feed.js';

test('lyrics descriptors use current playback position after loading and saved position while paused', () => {
    const firstTrack = { file: { name: 'first.wav' } };
    const snapshot = { currentTrack: firstTrack, currentTrackPosition: 7, currentTrackDuration: 20,
        playbackSpeed: 1.5, isPlaying: true, isStopped: false };
    let data = null, livePosition = 8, liveReads = 0, lyricsReads = 0;
    const player = {
        ui: { container: {} },
        stateManager: { getStateSnapshot: () => snapshot },
        trackLyrics: { get(track) { assert.equal(track, snapshot.currentTrack); lyricsReads += 1; return data; } },
        contextManager: { getCurrentPlaybackTime() { liveReads += 1; return livePosition; } }
    };
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        hasLyrics: true,
        uiManager: { audioPlayer: player,
            audioManager: { getAudiblePlaybackPosition: (position, speed) => position - 0.2 * speed } }
    });

    assert.equal(view.lyrics(), null);
    assert.equal(liveReads, 0);
    data = { synced: true, lines: [{ time: 0, text: 'First line' }] };
    livePosition = 12;
    assert.deepEqual(view.lyrics(), { data, time: 11.7, duration: 20, isStopped: false });

    snapshot.isPlaying = false;
    snapshot.currentTrackPosition = 3;
    const paused = view.lyrics();
    assert.equal(paused.time, 2.7);
    assert.equal(liveReads, 1);
    snapshot.currentTrackPosition = 10;
    assert.equal(view.lyrics().time, 9.7);
    snapshot.isStopped = true;
    snapshot.currentTrackPosition = 0;
    assert.equal(view.lyrics().isStopped, true);

    snapshot.currentTrack = { file: { name: 'second.wav' } };
    data = null;
    assert.equal(view.lyrics(), null);
    snapshot.currentTrack = null;
    assert.equal(view.lyrics(), null);
    snapshot.currentTrack = firstTrack;
    assert.equal(view.lyrics(), null);

    const readCount = lyricsReads;
    view.hasLyrics = false;
    assert.equal(view.lyrics(), null);
    assert.equal(lyricsReads, readCount);
});

test('Clean Feed passes ready lyrics and immediate absence to its renderer unchanged', () => {
    let descriptor = { data: { synced: true, lines: [{ time: 0, text: 'First line' }] },
        time: 10, duration: 30, isStopped: false };
    const canvas = { style: {}, width: 128, height: 72 };
    let rendered;
    const feed = Object.assign(Object.create(VisualizerFeed.prototype), {
        visible: true, canvas,
        window: { closed: false, innerWidth: 128, innerHeight: 72, devicePixelRatio: 1, requestAnimationFrame: () => 1 },
        view: { layout: { aspect: '16:9' }, sources: { getStatus: () => 'ready' },
            metadata: () => null, lyrics: () => descriptor, quality: 'auto', video: { frame: () => null } },
        renderer: { draw(...args) { rendered = args; } }
    });
    feed.frame(1000);
    assert.equal(rendered[4].lyrics, descriptor);
    assert.equal(rendered[3], 1);
    assert.equal(feed.frameRequest, 1);
    descriptor = null;
    feed.frame(2000);
    assert.equal(rendered[4].lyrics, null);
});
