import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { VisualizerFeed } from '../../js/visualizer/visualizer-feed.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';
import { AudioContextManager } from '../../js/ui/audio-player/audio-context-manager.js';
import { MediaSessionManager } from '../../js/ui/audio-player/media-session-manager.js';
import { createItem, encodeLayoutShare, decodeLayoutShare } from '../../js/visualizer/visualizer-model.js';

function setup() {
    const commands = [], state = { currentTrack: {}, playlistLength: 2, isPlaying: false, isStopped: true,
        controlsEnabled: true, repeatMode: 'OFF', shuffleMode: false };
    const player = { ui: { container: {} }, stateManager: { getStateSnapshot: () => state }, playbackManager: {
        runPlaybackCommand(command) { commands.push('execute'); return Promise.resolve(command()); },
        toggleShuffleMode() { commands.push('shuffle'); }, toggleRepeatMode() { commands.push('repeat'); }
    } };
    for (const [method, action] of [['togglePlayPause', 'play-pause'], ['stop', 'stop'], ['playPrevious', 'previous'], ['playNext', 'next']]) {
        player[method] = function () { assert.equal(this, player); commands.push(action); return true; };
    }
    const view = Object.assign(Object.create(VisualizerView.prototype), {
        uiManager: { audioPlayer: player, getPlaybackTarget: () => player, t: key => key },
        editor: { open: false }, layout: { items: [] },
        canvas: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }) },
        renderer: { playbackItemAt: (_layout, x, y) => x >= .25 && x <= .75 && y >= .25 && y <= .75 ? { id: 'control', action: 'play-pause' } : null }
    });
    return { view, player, state, commands };
}

test('Visualizer shares AirPlay metadata, artwork and reported time without a playable URL', () => {
    const { view, player, state } = setup();
    Object.assign(state, { currentTrack: null, playlistLength: 0, isPlaying: true, isStopped: false,
        liveInputActive: true, currentTrackName: 'AirPlay', artworkUrl: 'blob:cover',
        currentTrackPosition: 292, currentTrackDuration: 319, seekBarEnabled: false,
        transportCapabilities: { stop: true }, liveInputInformation: { metadata: { title: 'Song', artist: 'Artist',
            album: 'Album', genre: 'Jazz', composer: 'Composer' }, sender: { name: 'iPad' },
            format: { codec: 'ALAC', sampleRate: 44100, channels: 2, bitsPerSample: 16 } } });
    player.mediaSessionManager = { buildMetadata: snapshot => MediaSessionManager.prototype.buildMetadata.call({}, snapshot) };
    player.contextManager = { getCurrentState: () => state,
        getCurrentPlaybackTime: AudioContextManager.prototype.getCurrentPlaybackTime };
    player.airPlayPlayback = {};
    assert.equal(view.metadata().title, 'Song');
    assert.equal(view.metadata().artwork[0].src, 'blob:cover');
    assert.match(view.metadata()['track-info'], /Genre: Jazz/);
    assert.equal(view.playback().position, 292);
    assert.equal(view.playback().seekEnabled, false);
    assert.deepEqual(Object.entries(view.playback().enabled).filter(([, enabled]) => enabled).map(([action]) => action), ['stop']);
    view.layout.items = [createItem('counter', 'time'), createItem('track-info', 'details')];
    assert.equal(view.counters(1000).get('time').time, 292);
    assert.equal(view.counters(9000).get('time').time, 292, 'Counter must not invent a wall clock while sender progress is unchanged');
    assert.equal(view.counters(9000).get('time').external, false);
    const shared = decodeLayoutShare(encodeLayoutShare({ ...view.layout, aspect: '16:9' }));
    assert.equal(shared.items[1].type, 'track-info');
    Object.assign(state, { liveInputActive: false, liveInputInformation: null,
        currentTrackName: '', artworkUrl: '', currentTrackPosition: 0, currentTrackDuration: 0, isStopped: true, isPlaying: false });
    assert.equal(view.metadata(), null);
    assert.equal(view.playback().position, 0);
    state.currentTrack = { sampleRate: 48000, codec: 'FLAC',
        meta: { title: 'Local song', artist: 'Local artist', composer: 'Local composer', date: '2026',
            originalTrackNumber: 4, sampleRate: 44100, bitsPerSample: 24, channels: 2, bitrate: 960000 } };
    assert.equal(view.metadata().title, 'Local song');
    assert.match(view.metadata()['track-info'], /Composer: Local composer/);
    assert.match(view.metadata()['track-info'], /Date: 2026\nTrack number: 4/);
    assert.match(view.metadata()['track-info'], /Source audio: FLAC \/ 48 kHz \/ 24-bit \/ 2 ch \/ 960 kbps/);
    assert.doesNotMatch(view.metadata()['track-info'], /Receiver PCM/);
    assert.doesNotMatch(view.metadata()['track-info'], /AirPlay|ALAC|iPad/);
});

function setupPlaybackControls() {
    const fixture = setup(), document = createFakeDocument();
    const createElement = document.createElement.bind(document);
    document.createElement = tag => Object.assign(createElement(tag), {
        removeAttribute(name) { delete this.attributes[name]; },
        remove() { this.parentNode?.removeChild(this); },
        insertBefore(child, reference) {
            child.parentNode?.removeChild(child);
            this.children.splice(reference ? this.children.indexOf(reference) : this.children.length, 0, child);
            child.parentNode = this;
            return child;
        }
    });
    fixture.view.showControls = () => {};
    Object.assign(fixture.state, { currentTrackDuration: 120, currentTrackPosition: 20, seekBarEnabled: true });
    fixture.player.contextManager = { seek: time => fixture.commands.push(['seek', time]) };
    fixture.view.layout.items = [
        { id: 'play', type: 'playback-control', params: { action: 'play-pause' } },
        { id: 'shuffle', type: 'playback-control', params: { action: 'shuffle' } },
        { id: 'seek', type: 'seek-bar', params: {} }
    ];
    const host = document.createElement('div'), owner = { canvas: { style: {} } };
    fixture.view.createPlaybackControls(host, owner);
    fixture.view.syncPlaybackControls(owner);
    return { ...fixture, host, owner };
}

test('Accessible playback controls dispatch current actions and seek values while isolating canvas events', async () => {
    const { view, commands, host, owner } = setupPlaybackControls();
    const button = owner.playbackButtons.get('play'), range = owner.playbackButtons.get('seek');
    assert.equal(host.children[0], owner.playbackControls);
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.type, 'button');
    assert.equal(range.tagName, 'INPUT');
    assert.equal(range.type, 'range');

    view.layout.items[0] = { id: 'play', type: 'playback-control', params: { action: 'next' } };
    view.syncPlaybackControls(owner);
    assert.equal(owner.playbackButtons.get('play'), button);
    let stopped = false;
    await button.dispatchEvent('click', { stopPropagation() { stopped = true; } });
    assert.equal(stopped, true, 'Button activation must not reach canvas click handlers');
    assert.deepEqual(commands.splice(0), ['execute', 'next']);

    await button.dispatchEvent('focus');
    assert.equal(owner.playbackFocusedId, 'play');
    assert.equal(view.playbackFocusedId, undefined, 'Clean Feed focus belongs to its own surface');
    await range.dispatchEvent('focus');
    await button.dispatchEvent('blur');
    assert.equal(owner.playbackFocusedId, 'seek');
    await range.dispatchEvent('blur');
    assert.equal(owner.playbackFocusedId, null);

    assert.equal(range.max, '120');
    range.value = '45';
    await range.dispatchEvent('change');
    assert.deepEqual(commands.splice(0), ['execute', ['seek', 45]]);
    range.max = '240';
    range.value = '60';
    await range.dispatchEvent('change');
    assert.deepEqual(commands.splice(0), ['execute', ['seek', 30]]);
    for (const type of ['click', 'keydown']) {
        stopped = false;
        await range.dispatchEvent(type, { key: 'ArrowRight', stopPropagation() { stopped = true; } });
        assert.equal(stopped, true, `Seek ${type} must not reach canvas handlers`);
    }
    assert.deepEqual(commands, []);
});

test('Accessible playback synchronization preserves elements and updates state, order, and focus lifetime', async () => {
    const { view, state, owner } = setupPlaybackControls();
    const button = owner.playbackButtons.get('play'), shuffle = owner.playbackButtons.get('shuffle');
    const range = owner.playbackButtons.get('seek');
    assert.equal(button.textContent, 'Play');
    assert.equal(button.disabled, false);
    assert.equal(shuffle.getAttribute('aria-pressed'), 'false');
    assert.equal(range.disabled, false);
    assert.equal(range.getAttribute('aria-label'), 'Seek Bar');
    assert.equal(range.getAttribute('aria-valuetext'), '0:20 / 2:00');

    Object.assign(state, { isPlaying: true, controlsEnabled: false, shuffleMode: true,
        currentTrackDuration: 90, currentTrackPosition: 45 });
    view.syncPlaybackControls(owner);
    for (const [id, element] of [['play', button], ['shuffle', shuffle], ['seek', range]]) {
        assert.equal(owner.playbackButtons.get(id), element);
    }
    assert.equal(button.textContent, 'Pause');
    assert.equal(button.disabled, true);
    assert.equal(shuffle.getAttribute('aria-pressed'), 'true');
    assert.equal(range.disabled, true);
    assert.equal(range.max, '90');

    state.isPlaying = false;
    state.controlsEnabled = true;
    view.layout.items = [view.layout.items[2], view.layout.items[0],
        { id: 'shuffle', type: 'playback-control', params: { action: 'next' } }];
    await button.dispatchEvent('focus');
    view.syncPlaybackControls(owner);
    assert.deepEqual(owner.playbackControls.children, [range, button, shuffle]);
    assert.equal(owner.playbackFocusedId, 'play');
    assert.equal(button.disabled, false);
    assert.equal(shuffle.textContent, 'Next track');
    assert.equal(shuffle.hasAttribute('aria-pressed'), false);
    assert.equal(range.value, '45');
    assert.equal(range.getAttribute('aria-valuetext'), '0:45 / 1:30');

    await range.dispatchEvent('focus');
    view.layout.items = view.layout.items.filter(item => item.id !== 'seek');
    view.syncPlaybackControls(owner);
    assert.equal(range.parentNode, null);
    assert.equal(owner.playbackButtons.has('seek'), false);
    assert.equal(owner.playbackFocusedId, null);
    assert.deepEqual(owner.playbackControls.children, [button, shuffle]);

    await button.dispatchEvent('focus');
    view.editor.open = true;
    view.syncPlaybackControls(owner);
    assert.deepEqual(owner.playbackControls.children, []);
    assert.equal(owner.playbackButtons.size, 0);
    assert.equal(button.parentNode, null);
    assert.equal(shuffle.parentNode, null);
    assert.equal(owner.playbackFocusedId, null);
});

test('Visualizer dispatches all existing player commands synchronously and follows selected remote capabilities', async () => {
    const { view, player, state, commands } = setup();
    for (const action of ['play-pause', 'stop', 'previous', 'next', 'shuffle', 'repeat']) {
        const result = view.runPlaybackAction(action);
        assert.deepEqual(commands.splice(0), ['execute', action], 'The audio user gesture is preserved');
        await result;
    }
    state.isPlaying = true;
    state.shuffleMode = true;
    state.repeatMode = 'ALL';
    assert.equal(view.playback().labels['play-pause'], 'Pause');
    assert.equal(view.playback().shuffle, true);
    assert.equal(view.playback().repeat, 'ALL');
    view.uiManager.audioPlayer = { togglePlayPause() { assert.fail('Must not dispatch to retained local player'); } };
    player.isRemote = true;
    state.currentTrack = null;
    state.playlistLength = 0;
    state.transportCapabilities = { play: true, pause: false, stop: true, next: false, previous: true, repeat: true, shuffle: true };
    assert.equal(view.playback().enabled['play-pause'], false);
    await view.runPlaybackAction('play-pause');
    assert.deepEqual(commands, []);
    state.isPlaying = false;
    await view.runPlaybackAction('play-pause');
    assert.deepEqual(commands.splice(0), ['execute', 'play-pause']);
    state.repeatMode = 'ONE';
    assert.equal(view.playback().enabled.shuffle, false);
    assert.equal(view.playback().enabled.repeat, true);
    state.controlsEnabled = false;
    assert.ok(Object.values(view.playback().enabled).every(value => !value));
});

test('Missing, empty, closed, disabled, or editing players cannot be activated', async () => {
    const { view, player, state, commands } = setup();
    view.editor.open = true;
    await view.runPlaybackAction('next');
    view.editor.open = false;
    state.currentTrack = null;
    state.playlistLength = 0;
    assert.equal(view.playback().available, true, 'An open empty player remains visible');
    await view.runPlaybackAction('play-pause');
    state.currentTrack = {};
    player.ui.container = null;
    assert.equal(view.playback().available, false);
    await view.runPlaybackAction('play-pause');
    view.uiManager = { t: key => key };
    assert.ok(Object.values(view.playback().enabled).every(value => !value));
    await view.runPlaybackAction('stop');
    assert.deepEqual(commands, []);
});

test('Seek gestures preview without transport churn, commit once on release, and release capture on disappearance', () => {
    const { view, player, state, commands } = setup();
    Object.assign(state, { currentTrackDuration: 120, currentTrackPosition: 20, seekBarEnabled: true });
    player.contextManager = { getCurrentPlaybackTime: () => 25, seek: time => commands.push(['seek', time]) };
    player.resumeAudioContextInGesture = () => commands.push('resume');
    let captured = false;
    Object.assign(view.canvas, { style: {}, setPointerCapture() { captured = true; }, hasPointerCapture: () => captured,
        releasePointerCapture() { captured = false; } });
    Object.assign(view.renderer, { playbackItemAt: () => ({ id: 'seek', value: .25 }), seekBarValue: (_layout, _id, x) => Math.max(0, Math.min(1, x)) });
    view.layout.items = [{ id: 'seek', type: 'seek-bar', params: {} }];
    const event = { clientX: 60, clientY: 70, pointerId: 1, button: 0, target: {}, preventDefault() {} };
    assert.equal(view.beginSeekPointer(event), true);
    assert.equal(captured, true);
    assert.equal(view.playback().seekPosition, 30);
    for (let x = 80; x <= 160; x++) view.moveSeekPointer({ ...event, clientX: x });
    assert.deepEqual(commands, []);
    view.finishSeekPointer({ ...event, clientX: 160 });
    assert.deepEqual(commands.splice(0), ['execute', 'resume', ['seek', 90]]);
    assert.equal(captured, false);
    assert.equal(view.activatePlaybackControl(event), true, 'Release click cannot fall through to another canvas action');
    view.beginSeekPointer(event);
    view.cancelSeekPointer();
    assert.equal(captured, false);
    assert.deepEqual(commands, []);
    view.beginSeekPointer(event);
    player.ui.container = null;
    view.playbackControls = {};
    view.playbackButtons = new Map();
    view.syncPlaybackControls();
    assert.equal(captured, false);
    assert.equal(view.seekGesture, null);
    assert.equal(view.seekBarAt(event), null);
    assert.equal(view.playback().available, false);
});

test('Seek state follows the selected player and blocks unknown duration, lost capability, editing, and changed tracks', async () => {
    const { view, player, state, commands } = setup();
    Object.assign(state, { currentTrackDuration: 120, currentTrackPosition: 20, seekBarEnabled: true });
    player.contextManager = { getCurrentPlaybackTime: () => 25, seek: time => commands.push(['seek', time]) };
    assert.equal(view.playback().position, 20);
    state.isPlaying = true;
    assert.equal(view.playback().position, 25);
    state.currentTrackDuration = Infinity;
    assert.equal(view.playback().seekEnabled, false);
    await view.seekPlayback(.5);
    state.currentTrackDuration = 120;
    player.isRemote = true;
    state.transportCapabilities = { seek: false };
    await view.seekPlayback(.5);
    state.transportCapabilities.seek = true;
    view.editor.open = true;
    await view.seekPlayback(.5);
    view.editor.open = false;
    const oldTrack = state.currentTrack;
    state.currentTrack = {};
    await view.seekPlayback(.5, player, oldTrack);
    assert.deepEqual(commands, []);
    await view.seekPlayback(.5);
    assert.deepEqual(commands, ['execute', ['seek', 60]]);
});

test('Playback hits use rendered coordinates, consume disabled buttons, and ignore editing or moved pointers', () => {
    const { view, state, commands } = setup();
    const event = { clientX: 110, clientY: 70, button: 0, target: { closest: () => null } };
    view.beginPlaybackPointer(event);
    assert.equal(view.activatePlaybackControl(event), true);
    assert.deepEqual(commands.splice(0), ['execute', 'play-pause']);
    view.beginPlaybackPointer(event);
    view.movePlaybackPointer({ ...event, clientX: 140 });
    view.activatePlaybackControl(event);
    view.beginPlaybackPointer(event);
    view.activatePlaybackControl({ ...event, defaultPrevented: true });
    view.beginPlaybackPointer(event);
    view.clearPlaybackPointer();
    view.activatePlaybackControl(event);
    state.controlsEnabled = false;
    view.beginPlaybackPointer(event);
    assert.equal(view.activatePlaybackControl(event), true);
    assert.deepEqual(commands, []);
    view.editor.open = true;
    assert.equal(view.playbackControlAt(event), null);
    assert.equal(view.activatePlaybackControl(event), false);
    view.editor.open = false;
    assert.equal(view.playbackControlAt({ ...event, target: { closest: () => ({}) } }), null);
});

test('Clean Feed draws current playback state and owns its pointer coordinates', () => {
    const { view, commands } = setup();
    let options;
    const feed = Object.assign(Object.create(VisualizerFeed.prototype), {
        view, visible: true, canvas: { style: {}, width: 800, height: 450,
            getBoundingClientRect: () => ({ left: 30, top: 40, width: 800, height: 450 }) }, hdrCanvas: { style: {} },
        window: { closed: false, innerWidth: 800, innerHeight: 450, devicePixelRatio: 1, requestAnimationFrame() {} },
        renderer: { playbackItemAt: (_layout, x, y) => x === .5 && y === .5 ? { id: 'feed-control', action: 'next' } : null,
            draw(...args) { options = args[4]; } }
    });
    Object.assign(view, { layout: { aspect: '16:9', items: [] }, sources: { getStatus: () => 'ready' },
        metadata: () => null, lyrics: () => null, videoFrame: () => null, counters: () => new Map(), feed });
    const event = { clientX: 430, clientY: 265, button: 0, target: {} };
    view.beginPlaybackPointer(event, feed);
    assert.equal(view.activatePlaybackControl(event, feed), true);
    assert.deepEqual(commands, ['execute', 'next']);
    feed.playbackFocusedId = 'feed-control';
    feed.frame(1000);
    assert.equal(options.playback.focusedId, 'feed-control');
    assert.equal(options.playback.enabled.next, true);
});
