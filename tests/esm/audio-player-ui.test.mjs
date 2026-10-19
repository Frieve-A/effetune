import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioPlayerUI } from '../../js/ui/audio-player/audio-player-ui.js';
import { StateManager } from '../../js/ui/audio-player/state-manager.js';
import { SynchronizedVideo } from '../../js/ui/audio-player/synchronized-video.js';
import { VisualizerView } from '../../js/visualizer/visualizer-view.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('starting a selected video unfolds once, preserving a later manual fold through maintenance and resume', async () => {
  await withAudioPlayerGlobals({}, async ({ calls, documentRef }) => {
    const track = { name: 'Movie.mp4', path: '/movie.mp4' };
    const contextManager = { activeSourceGeneration: 1 };
    const player = createAudioPlayer(calls, {
      contextManager, state: { playbackMode: 'audioElement', currentTrack: track }
    });
    player.audioManager = { getAudiblePlaybackPosition: () => 0 };
    const master = documentRef.createElement('video');
    Object.assign(master, { videoWidth: 0, src: 'blob:movie' });
    player.audioElement = master;
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    try {
      ui.setDesktopQueueExpanded(false);
      player.stateManager.setState({ isPlaying: true });
      player.stateManager.emit('isPlaying', true);
      assert.equal(container.getAttribute('data-expanded'), 'false', 'wait for actual video metadata');
      master.videoWidth = 640;
      ui.updateVideoPresentation();
      assert.equal(container.getAttribute('data-expanded'), 'true');
      assert.equal(ui.videoExpanded, false, 'ordinary panel expansion does not enter full screen');
      ui.expandButton.click();
      assert.equal(container.getAttribute('data-expanded'), 'false');
      player.stateManager.emit('currentTrack', track);
      player.stateManager.emit('currentTrackPosition', 10);
      ui.updateVideoPresentation();
      player.stateManager.setState({ isPlaying: false });
      player.stateManager.emit('isPlaying', false);
      player.stateManager.setState({ isPlaying: true });
      player.stateManager.emit('isPlaying', true);
      assert.equal(container.getAttribute('data-expanded'), 'false');

      // An audio-device rebuild replaces even a paused media source without a new selection.
      player.stateManager.setState({ isPlaying: false });
      contextManager.activeGraphRebuildRequest = {};
      contextManager.activeSourceGeneration = 2;
      const replacement = documentRef.createElement('video');
      Object.assign(replacement, { videoWidth: 0, src: 'blob:rebound-movie' });
      player.audioElement = replacement;
      player.stateManager.emit('currentTrack', track);
      contextManager.activeGraphRebuildRequest = null;
      replacement.videoWidth = 640;
      ui.updateVideoPresentation();
      player.stateManager.setState({ isPlaying: true });
      player.stateManager.emit('isPlaying', true);
      assert.equal(container.getAttribute('data-expanded'), 'false');

      contextManager.activeSourceGeneration = 3;
      player.stateManager.emit('currentTrack', track);
      assert.equal(container.getAttribute('data-expanded'), 'true', 'reselecting the same video is a new playback');
      ui.expandButton.click();
      contextManager.activeSourceGeneration = 4;
      player.stateManager.setState({ isPlaying: false, currentTrack: { name: 'Next.mp4', path: '/next.mp4' } });
      player.stateManager.emit('currentTrack', player.stateManager.state.currentTrack);
      assert.equal(container.getAttribute('data-expanded'), 'false', 'loading alone does not unfold');
      player.stateManager.setState({ isPlaying: true });
      player.stateManager.emit('isPlaying', true);
      assert.equal(container.getAttribute('data-expanded'), 'true', 'next video playback can unfold again');
    } finally {
      ui.removeUI();
    }
  });
});

test('video auto-unfold leaves audio, mini mode, and the already expanded mobile layout unchanged', async () => {
  await withAudioPlayerGlobals({}, async ({ calls, documentRef, windowRef }) => {
    const contextManager = { activeSourceGeneration: 1 };
    const player = createAudioPlayer(calls, { contextManager, state: { playbackMode: 'audioElement' } });
    player.audioManager = { getAudiblePlaybackPosition: () => 0 };
    const master = documentRef.createElement('video');
    Object.assign(master, { videoWidth: 0, src: 'blob:audio-only' });
    player.audioElement = master;
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    try {
      ui.setDesktopQueueExpanded(false);
      player.stateManager.setState({ isPlaying: true });
      player.stateManager.emit('isPlaying', true);
      assert.equal(container.getAttribute('data-expanded'), 'false', 'audio-only media remains folded');
      ui.setMiniMode(true);
      contextManager.activeSourceGeneration = 2;
      master.videoWidth = 640;
      ui.updateVideoPresentation();
      assert.equal(container.getAttribute('data-mini-player'), 'true');
      assert.equal(ui.desktopQueueExpanded, false);
      ui.setMiniMode(false);
      ui.updateVideoPresentation();
      assert.equal(container.getAttribute('data-expanded'), 'false', 'leaving mini does not replay auto-unfold');
      windowRef.uiManager.layoutMode = { isMobile: true };
      contextManager.activeSourceGeneration = 3;
      ui.updateVideoPresentation();
      assert.equal(ui.desktopQueueExpanded, false, 'mobile playback does not change the desktop preference');
      windowRef.uiManager.layoutMode.isMobile = false;
      ui.updateVideoPresentation();
      assert.equal(container.getAttribute('data-expanded'), 'false');
    } finally {
      ui.removeUI();
    }
  });
});

test('video preview reveals controls on activity, hides when idle, and cleans up across modes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withAudioPlayerGlobals({}, async ({ calls, documentRef }) => {
    const player = createAudioPlayer(calls, { state: { playbackMode: 'audioElement', playbackSpeed: 1 } });
    player.audioManager = { getAudiblePlaybackPosition: time => time - 0.4 };
    const video = documentRef.createElement('video');
    video.videoWidth = 640;
    video.src = 'blob:audio-master';
    video.currentTime = 5;
    player.audioElement = video;
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    try {
      assert.notEqual(ui.videoElement, video);
      assert.equal(ui.videoElement.muted, true);
      assert.equal(ui.videoElement.src, video.src);
      assert.equal(video.parentNode, null);
      assert.equal(ui.videoElement.parentNode, ui.artworkImage.parentNode);
      ui.videoElement.videoWidth = 640;
      ui.videoElement.dispatchEvent('loadeddata');
      assert.equal(ui.videoElement.currentTime, 4.6);
      assert.equal(video.currentTime, 5);
      assert.equal(ui.artworkImage.hidden, true);
      assert.equal(ui.videoExpandButton.hidden, false);
      assert.notEqual(container.getAttribute('data-video-controls'), 'true');
      container.dispatchEvent('pointerenter');
      assert.equal(container.getAttribute('data-video-controls'), 'true');
      t.mock.timers.tick(2000);
      container.dispatchEvent('pointermove');
      t.mock.timers.tick(2499);
      assert.equal(container.getAttribute('data-video-controls'), 'true');
      t.mock.timers.tick(1);
      assert.equal(container.getAttribute('data-video-controls'), 'false');
      assert.equal(ui.videoControlsTimer, null);
      container.dispatchEvent('pointerdown');
      assert.equal(container.getAttribute('data-video-controls'), 'true');
      t.mock.timers.tick(2500);
      assert.equal(container.getAttribute('data-video-controls'), 'false');
      ui.videoExpandButton.focus();
      container.dispatchEvent('focusin');
      assert.equal(container.getAttribute('data-video-controls'), 'true');
      t.mock.timers.tick(2500);
      assert.equal(documentRef.activeElement, ui.videoExpandButton);
      assert.equal(container.getAttribute('data-video-controls'), 'false');
      container.dispatchEvent('keydown', { key: 'Shift' });
      assert.equal(container.getAttribute('data-video-controls'), 'true');
      const controls = container.querySelector('.player-controls');
      ui.videoExpandButton.click();
      assert.equal(container.getAttribute('data-video-expanded'), 'true');
      assert.equal(container.getAttribute('data-video-controls'), 'true');
      assert.equal(container.querySelector('.player-controls'), controls);
      t.mock.timers.tick(2000);
      container.dispatchEvent('keydown', { key: 'Shift' });
      t.mock.timers.tick(2499);
      assert.equal(container.getAttribute('data-video-controls'), 'true');
      t.mock.timers.tick(1);
      assert.equal(documentRef.activeElement, ui.videoExpandButton);
      assert.equal(container.getAttribute('data-video-controls'), 'false');
      container.dispatchEvent('pointerdown');
      assert.equal(container.getAttribute('data-video-controls'), 'true');
      ui.onVideoKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
      assert.equal(ui.videoExpanded, false);
      assert.equal(documentRef.activeElement, ui.videoExpandButton);
      t.mock.timers.tick(2500);
      assert.equal(container.getAttribute('data-video-controls'), 'false');
      container.dispatchEvent('pointerdown');
      ui.setMiniMode(true);
      assert.equal(ui.videoControlsTimer, null);
      assert.equal(container.getAttribute('data-video-controls'), 'false');
      container.dispatchEvent('pointermove');
      assert.equal(ui.videoControlsTimer, null);
      ui.setMiniMode(false);
      container.dispatchEvent('pointerdown');
      assert.equal(container.getAttribute('data-video-controls'), 'true');
      ui.setVideoExpanded(true);
      const detachedDisplay = ui.videoElement;
      player.audioElement = null;
      player.stateManager.emit('playbackMode', 'bufferSource');
      assert.equal(ui.videoExpanded, false);
      assert.equal(ui.videoElement, null);
      assert.equal(ui.video.source, null);
      assert.equal(ui.video.element, null);
      assert.equal(detachedDisplay.src, undefined);
      assert.equal(video.src, 'blob:audio-master');
      assert.equal(video.parentNode, null);
      assert.equal(ui.videoExpandButton.hidden, true);
      assert.equal(ui.videoControlsTimer, null);
      player.audioElement = video;
      player.stateManager.emit('playbackMode', 'audioElement');
      container.dispatchEvent('pointerdown');
      assert.notEqual(ui.videoControlsTimer, null);
    } finally {
      ui.removeUI();
      assert.equal(ui.videoControlsTimer, null);
    }
  });
});

test('video mouse gestures distinguish a single click from expansion and cancel pending actions on lifecycle changes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withAudioPlayerGlobals({}, async ({ calls, documentRef }) => {
    const player = createAudioPlayer(calls, { state: { playbackMode: 'audioElement', playbackSpeed: 1 } });
    player.audioManager = { getAudiblePlaybackPosition: time => time };
    const master = documentRef.createElement('video');
    Object.assign(master, { videoWidth: 640, src: 'blob:gesture-master' });
    player.audioElement = master;
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    const pointer = (type, overrides = {}) => container.dispatchEvent(type, {
      target: ui.videoElement, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, clientX: 50, clientY: 50, ...overrides
    });
    const click = () => { pointer('pointerdown'); pointer('pointerup'); };
    const toggles = () => calls.filter(call => call[0] === 'togglePlayPause').length;
    try {
      click();
      assert.equal(toggles(), 0);
      assert.equal(calls.some(call => call[0] === 'resumeAudioContextInGesture'), true);
      t.mock.timers.tick(500);
      assert.equal(toggles(), 1);
      click();
      t.mock.timers.tick(200);
      click();
      assert.equal(ui.videoExpanded, true);
      t.mock.timers.tick(1000);
      assert.equal(toggles(), 1);
      click(); click();
      assert.equal(ui.videoExpanded, false);
      t.mock.timers.tick(1000);
      assert.equal(toggles(), 1);
      pointer('pointerdown');
      pointer('pointermove', { clientX: 80 });
      pointer('pointerup');
      t.mock.timers.tick(1000);
      assert.equal(toggles(), 1, 'dragging out and back must not count as a click');
      pointer('pointerdown', { button: 2 }); pointer('pointerup', { button: 2 });
      t.mock.timers.tick(1000);
      assert.equal(toggles(), 1);
      for (const target of [ui.videoExpandButton, ui.seekBar, ui.playPauseButton, ui.playlistDisplay]) {
        pointer('pointerdown', { target }); pointer('pointerup', { target });
      }
      t.mock.timers.tick(1000);
      assert.equal(toggles(), 1, 'controls and queue must not trigger video gestures');
      for (const cancel of [
        () => ui.setMiniMode(true),
        () => player.stateManager.emit('currentTrack', { name: 'next.webm' }),
        () => { master.src = 'blob:next'; ui.updateVideoPresentation(); },
        () => { player.audioElement = null; ui.updateVideoPresentation(); },
        () => pointer('pointercancel'),
        () => container.dispatchEvent('dragstart')
      ]) {
        click(); cancel(); t.mock.timers.tick(1000);
        assert.equal(toggles(), 1);
        ui.setMiniMode(false);
        player.audioElement = master;
        ui.updateVideoPresentation();
      }
      ui.setMiniMode(true);
      click(); click(); t.mock.timers.tick(1000);
      assert.equal(toggles(), 1);
      assert.equal(ui.videoExpanded, false);
      ui.setMiniMode(false);
      click();
    } finally {
      ui.removeUI();
    }
    t.mock.timers.tick(1000);
    assert.equal(toggles(), 1);
    assert.equal(ui.videoGestureTimer, null);
  });
});

test('video touch taps reveal controls and seek only with expanded same-side double taps', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withAudioPlayerGlobals({}, async ({ calls, documentRef }) => {
    const player = createAudioPlayer(calls, { state: { playbackMode: 'audioElement', playbackSpeed: 1, currentTrackDuration: 60 } });
    player.audioManager = { getAudiblePlaybackPosition: time => time };
    player.playbackManager.fastForward = () => calls.push(['forward']);
    player.playbackManager.rewind = () => calls.push(['rewind']);
    const master = documentRef.createElement('video');
    Object.assign(master, { videoWidth: 640, src: 'blob:touch-master' });
    player.audioElement = master;
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    ui.videoElement.rect = { left: 0, width: 400 };
    const tap = x => {
      const event = { target: ui.videoElement, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: 50 };
      container.dispatchEvent('pointerdown', event);
      container.dispatchEvent('pointerup', event);
      container.dispatchEvent('click', event);
    };
    const seeks = () => calls.filter(call => call[0] === 'forward' || call[0] === 'rewind');
    try {
      tap(50); tap(50);
      assert.equal(container.getAttribute('data-video-controls'), 'true');
      assert.deepEqual(seeks(), []);
      assert.equal(ui.videoExpanded, false);
      ui.setVideoExpanded(true);
      tap(50); tap(50);
      tap(350); tap(350);
      assert.deepEqual(seeks(), [['rewind'], ['forward']]);
      tap(50); tap(350);
      t.mock.timers.tick(1000);
      tap(350); t.mock.timers.tick(501); tap(350);
      assert.equal(seeks().length, 2);
      t.mock.timers.tick(501);
      player.stateManager.setState({ seekBarEnabled: false });
      tap(50); tap(50);
      assert.equal(seeks().length, 2);
      player.stateManager.setState({ seekBarEnabled: true, currentTrackDuration: Infinity });
      tap(50); tap(50);
      assert.equal(seeks().length, 2);
      player.stateManager.setState({ currentTrackDuration: 60 });
      tap(50);
      player.stateManager.emit('currentTrack', { name: 'other.webm' });
      tap(50);
      assert.equal(seeks().length, 2, 'track changes must reset double-tap pairing');
      ui.setMiniMode(true);
      tap(50); tap(50);
      t.mock.timers.tick(1000);
      assert.equal(seeks().length, 2);
      assert.equal(calls.some(call => call[0] === 'togglePlayPause'), false);
    } finally {
      ui.removeUI();
    }
  });
});

test('video rotation follows mobile expanded fit, live preference, metadata and exit lifecycle', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withAudioPlayerGlobals({ windowOptions: { uiManager: { layoutMode: { isMobile: true } } } }, async ({ calls, documentRef, windowRef }) => {
    Object.assign(windowRef, { innerWidth: 390, innerHeight: 720, appConfig: {} });
    const resizeListeners = new Set();
    windowRef.addEventListener = (type, callback) => { if (type === 'resize') resizeListeners.add(callback); };
    windowRef.removeEventListener = (type, callback) => { if (type === 'resize') resizeListeners.delete(callback); };
    const player = createAudioPlayer(calls, { state: { playbackMode: 'audioElement', playbackSpeed: 1 } });
    player.audioManager = { getAudiblePlaybackPosition: time => time };
    const master = documentRef.createElement('video');
    Object.assign(master, { videoWidth: 1920, videoHeight: 1080, src: 'blob:rotation' });
    player.audioElement = master;
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    try {
      assert.equal(ui.videoRotated, false, 'normal mobile preview stays unrotated');
      ui.setVideoExpanded(true);
      assert.equal(ui.videoRotated, true);
      assert.equal(container.getAttribute('data-video-rotated'), 'true');
      assert.equal(container.style['--video-rotated-width'], '720px');
      assert.equal(container.style['--video-rotated-height'], '390px');
      const event = { target: ui.videoElement, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 30, clientY: 30 };
      container.dispatchEvent('pointerdown', event); container.dispatchEvent('pointerup', event);
      windowRef.appConfig.videoAutoRotate = false;
      ui.refreshVideoRotation();
      assert.equal(ui.videoRotated, false);
      t.mock.timers.tick(1000);
      assert.equal(calls.some(call => call[0] === 'togglePlayPause'), false);
      windowRef.appConfig.videoAutoRotate = true;
      ui.refreshVideoRotation();
      assert.equal(ui.videoRotated, true);
      Object.assign(windowRef, { innerWidth: 720, innerHeight: 390 });
      for (const listener of resizeListeners) listener();
      assert.equal(ui.videoRotated, false, 'landscape video fits landscape viewport without turning');
      Object.assign(master, { videoWidth: 1080, videoHeight: 1920 });
      ui.updateVideoPresentation();
      assert.equal(ui.videoRotated, true, 'portrait video turns within landscape mobile viewport');
      Object.assign(master, { videoWidth: 1000, videoHeight: 1000 });
      ui.updateVideoPresentation();
      assert.equal(ui.videoRotated, false, 'equal fits do not rotate');
      Object.assign(master, { videoWidth: 1080, videoHeight: 1920 });
      ui.updateVideoPresentation();
      windowRef.uiManager.layoutMode.isMobile = false;
      ui.mountContainerForLayout('desktop');
      assert.equal(ui.videoRotated, false, 'desktop layout never rotates');
      windowRef.uiManager.layoutMode.isMobile = true;
      ui.mountContainerForLayout('mobile');
      assert.equal(ui.videoRotated, true);
      ui.setMiniMode(true);
      assert.equal(ui.videoRotated, false);
      assert.equal(container.style['--video-rotated-width'], '');
      ui.setMiniMode(false);
      ui.setVideoExpanded(true);
      player.audioElement = null;
      ui.updateVideoPresentation();
      assert.equal(ui.videoRotated, false);
      player.audioElement = master;
      ui.updateVideoPresentation();
      ui.setVideoExpanded(true);
      assert.equal(ui.videoRotated, true);
    } finally {
      ui.removeUI();
    }
    assert.equal(ui.videoRotated, false);
    assert.equal(resizeListeners.size, 0);
  });
});

test('rotated video uses local left/right tap coordinates and contains its speed popup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withAudioPlayerGlobals({ windowOptions: { uiManager: { layoutMode: { isMobile: true } } } }, async ({ calls, documentRef, windowRef }) => {
    Object.assign(windowRef, { innerWidth: 390, innerHeight: 720 });
    const player = createAudioPlayer(calls, { state: { playbackMode: 'audioElement', playbackSpeed: 1, currentTrackDuration: 60 } });
    player.audioManager = { getAudiblePlaybackPosition: time => time };
    player.playbackManager.fastForward = () => calls.push(['forward']);
    player.playbackManager.rewind = () => calls.push(['rewind']);
    const master = documentRef.createElement('video');
    Object.assign(master, { videoWidth: 1920, videoHeight: 1080, src: 'blob:rotation' });
    player.audioElement = master;
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    try {
      ui.setVideoExpanded(true);
      ui.videoElement.rect = { left: 0, top: 0, width: 390, height: 720 };
      const tap = y => {
        const event = { target: ui.videoElement, pointerId: 1, pointerType: 'touch', button: 0, clientX: 200, clientY: y };
        container.dispatchEvent('pointerdown', event); container.dispatchEvent('pointerup', event);
      };
      tap(100); tap(100);
      tap(600); tap(600);
      assert.deepEqual(calls.filter(call => ['forward', 'rewind'].includes(call[0])), [['rewind'], ['forward']]);
      ui.openSpeedPopup(command => command());
      assert.equal(ui.playerPopup.parentNode, container);
      ui.setVideoExpanded(false);
      assert.equal(ui.playerPopup, null);
      ui.openSpeedPopup(command => command());
      assert.equal(ui.playerPopup.parentNode, documentRef.body);
    } finally {
      ui.removeUI();
    }
  });
});

test('video follows audible time without moving the audio master, and wakes only for playback or paused changes', async () => {
  await withAudioPlayerGlobals({}, async ({ calls, documentRef, frames }) => {
    const player = createAudioPlayer(calls, { state: { playbackMode: 'audioElement', playbackSpeed: 1, isPlaying: true } });
    player.audioManager = { getAudiblePlaybackPosition: (time, speed) => Math.max(0, time - 0.4 * speed) };
    const master = documentRef.createElement('video');
    Object.assign(master, { videoWidth: 640, src: 'blob:master', currentTime: 5, paused: false });
    player.audioElement = master;
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();
    const display = ui.videoElement;
    try {
      display.videoWidth = 640;
      display.dispatchEvent('loadeddata');
      assert.equal(display.currentTime, 4.6);
      assert.equal(display.paused, false);
      assert.equal(master.currentTime, 5);
      assert.equal(master.paused, false);
      assert.notEqual(ui.videoRaf, null);
      master.currentTime = 8;
      frames.at(-1)();
      assert.equal(display.currentTime, 7.6);
      assert.equal(master.currentTime, 8);

      master.pause();
      player.stateManager.setState({ isPlaying: false });
      player.stateManager.emit('isPlaying', false);
      assert.equal(display.paused, true);
      assert.equal(ui.videoRaf, null);
      ui.setPowerUiEnabled(false);
      master.currentTime = 12;
      player.stateManager.setState({ currentTrackPosition: 12 });
      player.stateManager.emit('currentTrackPosition', 12);
      assert.equal(display.currentTime, 11.6);
      assert.equal(ui.videoRaf, null);
      display.seeking = true;
      master.currentTime = 13;
      player.stateManager.emit('currentTrackPosition', 13);
      display.seeking = false;
      display.dispatchEvent('seeked');
      assert.equal(display.currentTime, 12.6);

      ui.setPowerUiEnabled(true);
      player.stateManager.setState({ isPlaying: true, playbackSpeed: 2 });
      player.stateManager.emit('isPlaying', true);
      assert.equal(display.currentTime, 12.2);
      documentRef.hidden = true;
      documentRef.dispatchEvent('visibilitychange');
      assert.equal(display.paused, true);
      assert.equal(ui.videoRaf, null);
      documentRef.hidden = false;
      documentRef.dispatchEvent('visibilitychange');
      assert.equal(display.paused, false);
      assert.notEqual(ui.videoRaf, null);

      master.src = 'blob:next-master';
      player.stateManager.emit('currentTrack', { name: 'next.webm' });
      assert.notEqual(ui.videoElement, display);
      assert.equal(ui.videoElement.src, master.src);
      assert.equal(display.src, undefined);
      assert.equal(ui.video.ready, false);
      assert.equal(master.currentTime, 13);
    } finally {
      ui.removeUI();
    }
    assert.equal(ui.videoRaf, null);
    assert.equal(display.paused, true);
    assert.equal(display.src, undefined);
    assert.equal(master.src, 'blob:next-master');
    assert.equal((display.eventListeners.get('seeked') || []).length, 0);
  });
});

class FakeElement {
  constructor(tagName, ownerDocument, calls = []) {
    this.tagName = tagName.toUpperCase();
    if (this.tagName === 'VIDEO') {
      this.currentTime = 0;
      this.duration = 100;
      this.paused = true;
      this.seeking = false;
    }
    this.ownerDocument = ownerDocument;
    this.calls = calls;
    this.children = [];
    this.parentNode = null;
    this.eventListeners = new Map();
    this.className = '';
    this.textContent = '';
    this.title = '';
    this.value = '';
    this.disabled = false;
    this.style = {
      setProperty(name, value) { this[name] = value; }
    };
    this._innerHTML = '';
    this.offsetHeight = 20;
    this.scrollTop = 0;
    this.rect = null;
    this.id = '';
    this.attributes = new Map();
    this.dataset = {};
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === '') {
      this.children.forEach(child => {
        child.parentNode = null;
      });
      this.children = [];
    }
    if (this.classList().includes('audio-player')) {
      this.children = [];
      this.ownerDocument.populateAudioPlayerMarkup(value, this);
    }
    if (this.classList().includes('player-library-context-menu')) {
      this.children = [];
      const buttonPattern = /<button([^>]*)>/g;
      for (const match of value.matchAll(buttonPattern)) {
        const button = this.ownerDocument.createElement('button');
        button.className = /class="([^"]*)"/.exec(match[1])?.[1] ?? '';
        button.dataset.action = /data-action="([^"]*)"/.exec(match[1])?.[1];
        button.dataset.playlistId = /data-playlist-id="([^"]*)"/.exec(match[1])?.[1];
        button.disabled = /\sdisabled(?:\s|>|$)/.test(match[1]);
        this.appendChild(button);
      }
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  classList() {
    return this.className.split(/\s+/).filter(Boolean);
  }

  matches(selector) {
    return selector === 'input[type="range"]' && this.tagName === 'INPUT' && this.type === 'range';
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    const index = this.children.indexOf(reference);
    if (index === -1) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
    this.calls.push(['insertBefore', child.className, reference?.className ?? null]);
    return child;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    const index = siblings.indexOf(this);
    return index === -1 ? null : siblings[index + 1] ?? null;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    this.calls.push(['removeChild', child.className]);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    this[name] = String(value);
  }

  hasAttribute(name) { return name === 'src' ? !!this.src : this.attributes.has(name); }

  removeAttribute(name) { this.attributes.delete(name); delete this[name]; }

  pause() { this.paused = true; }

  play() { this.paused = false; return Promise.resolve(); }

  load() {}

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    this.eventListeners.set(type, (this.eventListeners.get(type) || []).filter(item => item !== listener));
  }

  dispatchEvent(type, event = {}) {
    const eventObject = { target: this, currentTarget: this, ...event };
    return (this.eventListeners.get(type) || []).map(listener => listener(eventObject));
  }

  click() {
    this.dispatchEvent('click');
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  contains(element) {
    return element === this || this.children.some(child => child.contains(element));
  }

  querySelector(selector) {
    if (selector.startsWith('.')) return this.findByClass(selector.slice(1));
    if (selector === 'button:not(:disabled)') {
      return this.children.find(child => child.tagName === 'BUTTON' && !child.disabled) ?? null;
    }
    const action = /^\[data-action="([^"]+)"\]$/.exec(selector)?.[1];
    if (action) return this.children.find(child => child.dataset.action === action) ?? null;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === 'button:not(:disabled)') {
      return this.children.filter(child => child.tagName === 'BUTTON' && !child.disabled);
    }
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return this.children.filter(child => child.classList().includes(className));
    }
    if (selector === '[data-playlist-id]') {
      return this.children.filter(child => child.dataset.playlistId);
    }
    return [];
  }

  scrollIntoView(options) {
    this.calls.push(['scrollIntoView', this.textContent, options]);
  }

  getBoundingClientRect() {
    return this.rect;
  }

  findByClass(className) {
    if (this.classList().includes(className)) return this;
    for (const child of this.children) {
      const match = child.findByClass(className);
      if (match) return match;
    }
    return null;
  }
}

function extractButtonContent(html, className) {
  const pattern = new RegExp(`<button[^>]*class="[^"]*${className}[^"]*"[^>]*title="([^"]*)"[^>]*>([\\s\\S]*?)<\\/button>`);
  const match = pattern.exec(html);
  return {
    title: match?.[1] ?? '',
    innerHTML: match?.[2] ?? ''
  };
}

function createDocument(calls, options = {}) {
  const documentRef = {
    body: null,
    mainContainer: null,
    dbtPanel: null,
    activeElement: null,
    eventListeners: new Map(),
    addEventListener(type, listener) {
      if (!this.eventListeners.has(type)) this.eventListeners.set(type, []);
      this.eventListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      this.eventListeners.set(type, (this.eventListeners.get(type) || []).filter(item => item !== listener));
    },
    dispatchEvent(type, event = {}) {
      for (const listener of this.eventListeners.get(type) || []) listener(event);
    },
    createElement(tagName) {
      return new FakeElement(tagName, documentRef, calls);
    },
    getElementById(id) {
      if (id === 'mobilePlayerView') return documentRef.mobilePlayerView ?? null;
      return null;
    },
    querySelector(selector) {
      calls.push(['documentQuerySelector', selector]);
      if (selector === '.main-container') return documentRef.mainContainer;
      if (selector === '.double-blind-test') return documentRef.dbtPanel;
      return null;
    },
    populateAudioPlayerMarkup(html, parent) {
      const artwork = this.createElement('div');
      artwork.className = 'player-artwork';
      const artworkPlaceholder = this.createElement('div');
      artworkPlaceholder.className = 'player-artwork-placeholder';
      const artworkImage = this.createElement('img');
      artworkImage.className = 'player-artwork-image';
      const artworkSpinner = this.createElement('div');
      artworkSpinner.className = 'player-loading-spinner player-loading-spinner-artwork';
      artwork.appendChild(artworkPlaceholder);
      artwork.appendChild(artworkImage);
      artwork.appendChild(artworkSpinner);
      parent.appendChild(artwork);

      const trackContainer = this.createElement('div');
      trackContainer.className = 'track-name-container';
      const trackName = this.createElement('div');
      trackName.className = 'track-name';
      trackName.textContent = 'No track loaded';
      const inlineSpinner = this.createElement('div');
      inlineSpinner.className = 'player-loading-spinner player-loading-spinner-inline';
      trackContainer.appendChild(inlineSpinner);
      trackContainer.appendChild(trackName);
      parent.appendChild(trackContainer);

      const controls = this.createElement('div');
      controls.className = 'player-controls';

      const seekBar = this.createElement('input');
      seekBar.className = 'seek-bar';
      seekBar.value = '0';
      controls.appendChild(seekBar);

      const timeDisplay = this.createElement('div');
      timeDisplay.className = 'time-display';
      timeDisplay.textContent = '00:00';
      controls.appendChild(timeDisplay);

      const buttonClasses = [
        'play-pause-button',
        'stop-button',
        'prev-button',
        'next-button',
        'repeat-button',
        'shuffle-button',
        'speed-button',
        'expand-button',
        'close-button'
      ];
      if (html.includes('mini-player-button')) {
        buttonClasses.splice(-2, 0, 'mini-player-button', 'restore-button', 'pin-button');
      }
      for (const className of buttonClasses) {
        const button = this.createElement('button');
        const content = extractButtonContent(html, className);
        button.className = `player-button ${className}`;
        button.title = content.title;
        button.innerHTML = content.innerHTML;
        controls.appendChild(button);
      }

      const playlist = this.createElement('div');
      playlist.className = 'player-playlist';
      controls.appendChild(playlist);

      parent.appendChild(controls);
    }
  };

  documentRef.body = documentRef.createElement('body');

  if (options.main !== false) {
    documentRef.mainContainer = documentRef.createElement('div');
    documentRef.mainContainer.className = 'main-container';
    if (!options.detachedMain) {
      documentRef.body.appendChild(documentRef.mainContainer);
    }
  }

  if (options.dbt) {
    documentRef.dbtPanel = documentRef.createElement('div');
    documentRef.dbtPanel.className = 'double-blind-test';
    documentRef.body.insertBefore(documentRef.dbtPanel, documentRef.mainContainer);
  }

  if (options.mobilePlayerView) {
    documentRef.mobilePlayerView = documentRef.createElement('div');
    documentRef.mobilePlayerView.id = 'mobilePlayerView';
    documentRef.mobilePlayerView.className = 'mobile-player-view';
    documentRef.body.appendChild(documentRef.mobilePlayerView);
  }

  return documentRef;
}

function createWindow(calls, options = {}) {
  if (options.uiManager === false) return { uiManager: null };
  const uiManager = {
    t(key) {
      calls.push(['translate', key]);
      return `T:${key}`;
    },
    ...(options.uiManager || {})
  };
  return {
    uiManager,
    electronAPI: options.electronAPI ?? null
  };
}

test('video tail survives real stop-state notifications and keeps its RAF after the master resets', async () => {
  await withAudioPlayerGlobals({}, async ({ calls, documentRef, frames }) => {
    const master = documentRef.createElement('video');
    Object.assign(master, { videoWidth: 640, src: 'blob:audio-master', currentTime: 0, duration: 10 });
    const presentation = { generation: 1, source: 'file:///movie.webm', resetToken: 0, naturalEnd: null, contextTime: 0 };
    const player = createAudioPlayer(calls, { audioElement: master, contextManager: { getVideoPresentation: () => presentation } });
    player.audioManager = { getAudiblePlaybackPosition: time => time - 0.8 };
    player.stateManager = new StateManager(player);
    player.stateManager.updateState({ currentTrack: { name: 'movie.webm' }, currentTrackDuration: 10, isPlaying: true, isStopped: false });
    const ui = player.ui = new AudioPlayerUI(player);
    ui.createPlayerUI();
    const display = ui.videoElement;
    try {
      Object.assign(display, { videoWidth: 640, duration: 10 });
      display.dispatchEvent('loadeddata');
      assert.equal(display.currentTime, 0);
      assert.equal(display.paused, true, 'the first frame waits for audible playback');
      master.currentTime = 2;
      frames.at(-1)();
      assert.equal(display.paused, false);
      assert.equal(display.currentTime, 1.2);

      presentation.contextTime = 10;
      presentation.naturalEnd = { generation: 1, source: presentation.source, endPosition: 10,
        playbackSpeed: 1, targetAtEnd: 9.2, contextTimeAtEnd: 10 };
      master.currentTime = 0;
      master.pause();
      player.stateManager.updateState({ isPlaying: false, isStopped: true, currentTrackPosition: 0 });
      assert.equal(ui.videoElement, display);
      assert.equal(display.currentTime, 9.2);
      assert.equal(display.paused, false);
      assert.notEqual(ui.videoRaf, null, 'tail animation must outlive the transport playing state');
      presentation.contextTime = 10.4;
      frames.at(-1)();
      assert.ok(Math.abs(display.currentTime - 9.6) < 1e-10);
      presentation.contextTime = 10.9;
      frames.at(-1)();
      assert.equal(display.currentTime, 10);
      assert.equal(display.paused, true);
      assert.equal(ui.videoRaf, null);
      assert.equal(master.currentTime, 0, 'display timing never moves the audio master');

      presentation.resetToken++;
      presentation.naturalEnd = null;
      player.stateManager.updateState({ currentTrackPosition: 0 });
      assert.equal(display.currentTime, 0, 'an explicit reset clears the retained final frame');
    } finally {
      ui.removeUI();
    }
    assert.equal(display.src, undefined);
    assert.equal(display.paused, true);
    assert.equal(ui.videoRaf, null);
  });
});

test('player and Visualizer retain independent outgoing decoders until the next audible decoded frame', async t => {
  await withAudioPlayerGlobals({}, async ({ calls, documentRef, frames }) => {
    const created = [], revoked = [];
    t.mock.method(URL, 'createObjectURL', () => `blob:display-${created.push(created.length + 1)}`);
    t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
    const elements = [];
    const createElement = documentRef.createElement.bind(documentRef);
    documentRef.createElement = tag => {
      const element = createElement(tag);
      if (tag === 'video') elements.push(element);
      return element;
    };
    const master = documentRef.createElement('video');
    Object.assign(master, { videoWidth: 640, src: 'blob:master-only', currentTime: 9.5, duration: 10 });
    const first = new Blob(['first']), next = new Blob(['next']);
    const presentation = { generation: 1, source: first, resetToken: 0, naturalEnd: null, contextTime: 9.5 };
    const player = createAudioPlayer(calls, { audioElement: master, contextManager: {
      getVideoPresentation: () => presentation, getCurrentPlaybackTime: () => master.currentTime
    } });
    player.audioManager = { getAudiblePlaybackPosition: time => time - 0.8 };
    player.stateManager = new StateManager(player);
    player.stateManager.updateState({ currentTrack: { name: 'first.webm', mediaSource: first }, currentTrackDuration: 10,
      isPlaying: true, isStopped: false });
    const ui = player.ui = new AudioPlayerUI(player);
    ui.createPlayerUI();
    const visualizerVideo = new SynchronizedVideo();
    visualizerVideo.setEnabled(true);
    visualizerVideo.setActive(true);
    const view = Object.assign(Object.create(VisualizerView.prototype), {
      uiManager: { audioPlayer: player, audioManager: player.audioManager }, video: visualizerVideo
    });
    view.videoFrame();
    const oldPlayer = ui.videoElement, oldVisualizer = visualizerVideo.element;
    for (const element of [oldPlayer, oldVisualizer]) {
      Object.assign(element, { videoWidth: 640, duration: 10 });
      element.dispatchEvent('loadeddata');
    }
    view.videoFrame();
    const oldUrls = [oldPlayer.src, oldVisualizer.src];
    assert.notEqual(...oldUrls);
    try {
      Object.assign(presentation, { contextTime: 10, naturalEnd: { generation: 1, source: first, endPosition: 10,
        playbackSpeed: 1, targetAtEnd: 9.2, contextTimeAtEnd: 10 } });
      master.currentTime = 0;
      player.stateManager.updateState({ isPlaying: false, isStopped: true, currentTrackPosition: 0 });
      view.videoFrame();
      Object.assign(presentation, { generation: 2, source: next });
      player.stateManager.updateState({ currentTrack: { name: 'next.webm', mediaSource: next }, isPlaying: true, isStopped: false });
      view.videoFrame();
      const pending = elements.filter(element => ![master, oldPlayer, oldVisualizer].includes(element));
      assert.equal(pending.length, 2, 'each presentation owns only one pending decoder');
      assert.equal(ui.videoElement, oldPlayer);
      assert.equal(view.videoFrame(), oldVisualizer);
      assert.deepEqual(revoked, []);

      presentation.contextTime = 11;
      master.currentTime = 0.2;
      frames.at(-1)();
      assert.equal(view.videoFrame(), oldVisualizer);
      assert.equal(oldPlayer.currentTime, 10, 'the final frame remains visible across loading and audible gaps');
      for (const element of pending) {
        Object.assign(element, { videoWidth: 640, duration: 10 });
        element.dispatchEvent('loadeddata');
      }
      frames.at(-1)();
      assert.equal(ui.videoElement, oldPlayer, 'decoded next video still waits for its audible start');
      master.currentTime = 1.2;
      frames.at(-1)();
      assert.equal(ui.videoElement, oldPlayer, 'the player retains its final frame while the next decoder seeks');
      assert.equal(view.videoFrame(), oldVisualizer, 'Visualizer also waits for the requested decoded frame');
      for (const element of pending) {
        assert.ok(Math.abs(element.currentTime - 0.4) < 1e-10);
        Object.assign(element, { seeking: false, readyState: 4 });
        element.dispatchEvent('seeked');
      }
      frames.at(-1)();
      const nextVisualizer = view.videoFrame();
      assert.notEqual(ui.videoElement, oldPlayer);
      assert.notEqual(nextVisualizer, oldVisualizer);
      assert.equal(ui.videoElement.parentNode, ui.artworkImage.parentNode);
      assert.equal(oldPlayer.parentNode, null);
      assert.equal((oldPlayer.eventListeners.get('seeked') || []).length, 0);
      assert.deepEqual(revoked.sort(), oldUrls.sort());
      assert.equal(master.src, 'blob:master-only');

      presentation.contextTime = 20;
      presentation.naturalEnd = { generation: 2, source: next, endPosition: 10,
        playbackSpeed: 1, targetAtEnd: 9.2, contextTimeAtEnd: 20 };
      player.stateManager.updateState({ isPlaying: false, isStopped: true });
      view.videoFrame();
      Object.assign(presentation, { generation: 3, source: first });
      player.stateManager.updateState({ currentTrack: { name: 'first.webm', mediaSource: first } });
      view.videoFrame();
      const interrupted = elements.slice(-2);
      Object.assign(presentation, { resetToken: 1, naturalEnd: null, source: null });
      player.stateManager.updateState({ currentTrack: null, currentTrackPosition: 0 });
      assert.equal(view.videoFrame(), null);
      assert.equal(ui.videoElement, null);
      assert.equal(ui.videoRaf, null);
      assert.ok(interrupted.every(element => !element.src && element.paused));
      assert.equal(new Set(revoked).size, created.length, 'manual cancellation releases current and pending URLs exactly once');
      assert.equal(revoked.length, created.length);
    } finally {
      ui.removeUI();
      visualizerVideo.setEnabled(false);
    }
  });
});

function createStateManager(initialState, calls) {
  const listeners = new Map();
  const manager = {
    state: {
      seekBarEnabled: true,
      repeatMode: 'OFF',
      shuffleMode: false,
      isPlaying: false,
      currentTrack: null,
      currentTrackPosition: 0,
      currentTrackDuration: 0,
      ...initialState
    },
    listeners,
    addListener(key, listener) {
      calls.push(['addListener', key]);
      if (!listeners.has(key)) {
        listeners.set(key, []);
      }
      listeners.get(key).push(listener);
    },
    removeListener(key, listener) {
      calls.push(['removeListener', key]);
      if (!listeners.has(key)) return;
      listeners.set(key, listeners.get(key).filter(candidate => candidate !== listener));
    },
    getStateSnapshot() {
      calls.push(['getStateSnapshot']);
      return { ...this.state };
    },
    setState(patch) {
      Object.assign(this.state, patch);
    },
    emit(key, value) {
      for (const listener of listeners.get(key) || []) {
        listener(value);
      }
    },
    emitAny(key, value, source) {
      for (const listener of listeners.get('*') || []) {
        listener(value, key, source);
      }
    }
  };
  return manager;
}

function createAudioPlayer(calls, options = {}) {
  const stateManager = options.stateManager === false
    ? null
    : createStateManager(options.state, calls);
  return {
    calls,
    stateManager,
    contextManager: options.contextManager,
    audioElement: options.audioElement,
    playbackManager: {
      toggleRepeatMode() {
        calls.push(['toggleRepeatMode']);
      },
      toggleShuffleMode() {
        calls.push(['toggleShuffleMode']);
      },
      setPlaybackSpeed(speed) {
        calls.push(['setPlaybackSpeed', speed]);
      },
      selectQueueOrdinal(ordinal, selectionOptions) {
        calls.push(['selectQueueOrdinal', ordinal, { ...selectionOptions }]);
        return Promise.resolve({ accepted: true });
      }
    },
    togglePlayPause() {
      calls.push(['togglePlayPause']);
    },
    async pause() {
      calls.push(['pause']);
    },
    stop() {
      calls.push(['stop']);
    },
    playPrevious() {
      calls.push(['playPrevious']);
    },
    playNext() {
      calls.push(['playNext']);
    },
    close() {
      calls.push(['close']);
    },
    async loadTrack(index) {
      calls.push(['loadTrack', index]);
    },
    async play(userInitiated) {
      calls.push(['play', userInitiated]);
    },
    resumeAudioContextInGesture() {
      calls.push(['resumeAudioContextInGesture']);
    }
  };
}

async function withAudioPlayerGlobals(options, callback) {
  const calls = [];
  const documentRef = options.document ?? createDocument(calls, options.documentOptions);
  const windowRef = options.window ?? createWindow(calls, options.windowOptions);
  const frames = [];
  const timers = new Map();
  const nativeConsole = globalThis.console;
  let nextTimer = 1;

  await withGlobals({
    document: documentRef,
    window: windowRef,
    requestAnimationFrame(fn) {
      calls.push(['requestAnimationFrame']);
      frames.push(fn);
      return frames.length;
    },
    cancelAnimationFrame(id) { calls.push(['cancelAnimationFrame', id]); },
    setInterval(fn, delay) {
      calls.push(['setInterval', delay]);
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearInterval(id) {
      calls.push(['clearInterval', id]);
      timers.delete(id);
    },
    console: {
      ...nativeConsole,
      warn(message) {
        calls.push(['warn', message]);
      }
    },
    ...(options.Image ? { Image: options.Image } : {})
  }, async () => callback({ calls, documentRef, windowRef, frames, timers }));
}

function createControlElement(calls, className = '') {
  const ownerDocument = {
    populateAudioPlayerMarkup() {}
  };
  const element = new FakeElement('button', ownerDocument, calls);
  element.className = className;
  return element;
}

test('creates translated controls, inserts before the double blind panel, and wires state listeners', async () => {
  await withAudioPlayerGlobals({
    documentOptions: { dbt: true },
    state: {
      repeatMode: 'ONE',
      shuffleMode: true,
      currentTrackPosition: 3,
      currentTrackDuration: 30
    }
  }, async ({ calls, documentRef, frames }) => {
    const player = createAudioPlayer(calls, {
      state: {
        repeatMode: 'ONE',
        shuffleMode: true,
        isPlaying: true,
        currentTrackPosition: 3,
        currentTrackDuration: 30
      }
    });
    player.audioContext = { state: 'running' };
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();

    assert.deepEqual([...player.stateManager.listeners.keys()].sort(), [
      '*',
      'artworkUrl',
      'currentTrack',
      'currentTrackDuration',
      'currentTrackIndex',
      'currentTrackName',
      'currentTrackPosition',
      'isTrackPresentationPending',
      'isPaused',
      'isPlaybackPending',
      'isPlaying',
      'isStopped',
      'playbackMode',
      'playbackSpeed',
      'playlist',
      'queueWindow'
    ].sort());
    assert.equal(documentRef.body.children[0], container);
    assert.equal(documentRef.body.children[1], documentRef.dbtPanel);
    assert.equal(ui.playPauseButton.title, 'T:ui.title.playPause');
    assert.match(ui.repeatButton.innerHTML, /M11\.3 10\.3/);
    assert.equal(ui.shuffleButton.disabled, true);
    assert.equal(ui.shuffleButton.style.opacity, '0.5');
    assert.equal(ui.speedButton.title, 'T:ui.title.playbackSpeed');
    assert.equal(ui.speedButton.textContent, '1x');

    ui.playPauseButton.dispatchEvent('click');
    ui.stopButton.dispatchEvent('click');
    ui.prevButton.dispatchEvent('click');
    ui.nextButton.dispatchEvent('click');
    ui.repeatButton.dispatchEvent('click');
    ui.shuffleButton.dispatchEvent('click');
    ui.speedButton.dispatchEvent('click');
    assert.equal(ui.playerPopup?.getAttribute('data-kind'), 'speed');
    ui.closePlayerPopup();
    await Promise.all(ui.closeButton.dispatchEvent('click'));

    assert.deepEqual(calls.filter(call => [
      'togglePlayPause',
      'stop',
      'playPrevious',
      'playNext',
      'toggleRepeatMode',
      'toggleShuffleMode',
      'pause',
      'close'
    ].includes(call[0])), [
      ['togglePlayPause'],
      ['stop'],
      ['playPrevious'],
      ['playNext'],
      ['toggleRepeatMode'],
      ['toggleShuffleMode'],
      ['pause'],
      ['close']
    ]);

    assert.equal(ui.handleStateChange('initialKey', 'initialValue', 'direct'), undefined);
    ui.handleStateChange = (key, value, source) => calls.push(['handleStateChange', key, value, source]);
    player.stateManager.emitAny('customKey', 'newValue', 'unit-test');
    assert.ok(calls.some(call => call[0] === 'handleStateChange' && call[1] === 'customKey'));

    player.stateManager.emit('currentTrack', { name: 'State listener track' });
    assert.equal(ui.trackNameDisplay.textContent, 'State listener track');

    player.stateManager.setState({ currentTrackPosition: 10, currentTrackDuration: 40 });
    player.stateManager.emit('currentTrackPosition', 10);
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.equal(ui.timeDisplay.textContent, '00:10 / 00:40');

    player.stateManager.emit('currentTrackDuration', 40);
    assert.equal(ui.timeDisplay.textContent, '00:10 / 00:40');

    player.stateManager.setState({ isPlaying: true });
    player.stateManager.emit('isPlaying', true);
    assert.match(ui.playPauseButton.innerHTML, /<rect x="7"/);

    player.stateManager.setState({ isPlaying: false });
    player.stateManager.emit('isPaused', true);
    assert.match(ui.playPauseButton.innerHTML, /M8 5\.14/);

    player.stateManager.setState({ currentTrackPosition: 0, currentTrackDuration: 0 });
    player.stateManager.emit('isStopped', true);
    assert.equal(ui.timeDisplay.textContent, '00:00 / 00:00');
    assert.match(ui.playPauseButton.innerHTML, /M8 5\.14/);
  });
});

test('close button waits for playback to fade before removing the player', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createAudioPlayer(calls, { state: { isPlaying: true } });
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    let finishFade;
    const fading = new Promise(resolve => { finishFade = resolve; });
    player.pause = () => {
      calls.push(['pause']);
      return fading;
    };
    player.close = () => {
      calls.push(['close']);
      ui.removeUI();
    };

    const closing = ui.closeButton.dispatchEvent('click')[0];
    try {
      assert.equal(ui.closeButton.disabled, true);
      assert.ok(container.parentNode);
      assert.equal(calls.some(call => call[0] === 'close'), false);
      await Promise.all(ui.closeButton.dispatchEvent('click'));
      assert.equal(calls.filter(call => call[0] === 'pause').length, 1);
    } finally {
      finishFade();
      await closing;
    }

    assert.equal(calls.filter(call => call[0] === 'close').length, 1);
    assert.equal(container.parentNode, null);
    assert.equal(ui.container, null);
  });
});

for (const isPaused of [false, true]) {
  test(`close button removes a ${isPaused ? 'paused' : 'stopped'} player without a fade delay`, async () => {
    await withAudioPlayerGlobals({}, async ({ calls }) => {
      const player = createAudioPlayer(calls, {
        state: { isPlaying: false, isPaused, isStopped: !isPaused }
      });
      const ui = new AudioPlayerUI(player);
      ui.createPlayerUI();
      await Promise.all(ui.closeButton.dispatchEvent('click'));
      assert.equal(calls.filter(call => call[0] === 'close').length, 1);
      ui.removeUI();
    });
  });
}

test('createPlayerUI uses fallback text and handles alternate insertion targets', async () => {
  await withAudioPlayerGlobals({
    documentOptions: {},
    windowOptions: { uiManager: false }
  }, async ({ documentRef, calls }) => {
    const ui = new AudioPlayerUI(createAudioPlayer(calls));
    const container = ui.createPlayerUI();

    assert.equal(documentRef.body.children[0], container);
    assert.equal(documentRef.body.children[1], documentRef.mainContainer);
    assert.equal(ui.playPauseButton.title, 'Play or pause');
    assert.equal(ui.stopButton.title, 'Stop');
    assert.equal(ui.prevButton.title, 'Previous track');
    assert.equal(ui.nextButton.title, 'Next track');
    assert.equal(ui.repeatButton.title, 'Toggle repeat mode');
    assert.equal(ui.shuffleButton.title, 'Toggle shuffle');
    assert.equal(ui.speedButton.title, 'Playback speed');
    assert.equal(ui.closeButton.title, 'Close player');
  });

  await withAudioPlayerGlobals({
    documentOptions: { detachedMain: true }
  }, async ({ documentRef, calls }) => {
    const ui = new AudioPlayerUI(createAudioPlayer(calls));
    const container = ui.createPlayerUI();

    assert.equal(container.parentNode, null);
    assert.equal(documentRef.body.children.includes(container), false);
  });
});

test('speed popup keeps presets, slider, number, and button display synchronized', async () => {
  await withAudioPlayerGlobals({}, async ({ calls, documentRef }) => {
    const player = createAudioPlayer(calls, { state: { playbackSpeed: 1 } });
    const ui = new AudioPlayerUI(player);
    player.playbackManager.setPlaybackSpeed = speed => {
      calls.push(['setPlaybackSpeed', speed]);
      player.stateManager.setState({ playbackSpeed: speed });
      ui.updatePlayerUIState();
    };
    ui.createPlayerUI();

    ui.speedButton.click();
    const popup = ui.playerPopup;
    const presets = popup.querySelector('.player-speed-presets').children;
    const slider = popup.querySelector('.player-speed-slider');
    const number = popup.querySelector('.player-speed-number');
    const assertSliderFill = () => {
      const fill = Number.parseFloat(slider.style['--et-range-fill']);
      assert.ok(Math.abs(fill - Number(slider.value) / 40) < 1e-9);
    };
    assert.equal(ui.speedButton.getAttribute('aria-expanded'), 'true');
    assert.equal(popup.getAttribute('role'), 'dialog');
    assert.deepEqual(presets.map(item => item.textContent), [
      '0.25x', '0.5x', '0.75x', '1x', '1.25x', '1.5x', '2x', '3x', '4x'
    ]);
    assert.equal(presets[3].getAttribute('aria-pressed'), 'true');
    assert.equal(slider.min, '0');
    assert.equal(slider.max, '4000');
    assert.equal(slider.value, '2000');
    assertSliderFill();
    assert.equal(slider.style['--et-range-origin'], '0%');
    assert.equal(slider.getAttribute('aria-valuetext'), '1x');
    assert.equal(number.value, '1');
    assert.equal(documentRef.activeElement, presets[3]);

    presets[4].click();
    assert.deepEqual(calls.filter(call => call[0] === 'setPlaybackSpeed'), [['setPlaybackSpeed', 1.25]]);
    assert.equal(ui.speedButton.textContent, '1.25x');
    assert.equal(ui.playerPopup, popup);
    assert.equal(presets[4].getAttribute('aria-pressed'), 'true');
    assert.equal(slider.value, String(Math.round(Math.log(1.25 / 0.25) / Math.log(16) * 4000)));
    assertSliderFill();
    assert.equal(number.value, '1.25');

    presets[0].click();
    assert.equal(slider.value, '0');
    assertSliderFill();
    presets[8].click();
    assert.equal(slider.value, '4000');
    assertSliderFill();

    slider.value = '2000';
    slider.dispatchEvent('input');
    assert.equal(ui.speedButton.textContent, '1x');
    assert.equal(slider.getAttribute('aria-valuetext'), '1x');
    slider.dispatchEvent('keydown', { key: 'ArrowRight', preventDefault() {} });
    assert.equal(ui.speedButton.textContent, '1.01x');
    slider.dispatchEvent('keydown', { key: 'ArrowLeft', preventDefault() {} });
    assert.equal(ui.speedButton.textContent, '1x');

    slider.value = '57';
    slider.dispatchEvent('input');
    assert.equal(ui.speedButton.textContent, '0.26x');
    assert.equal(number.value, '0.26');
    assertSliderFill();
    assert.equal(presets.some(item => item.getAttribute('aria-pressed') === 'true'), false);

    number.value = '1.235';
    number.dispatchEvent('keydown', { key: 'Enter', preventDefault() {} });
    assert.equal(ui.speedButton.textContent, '1.24x');
    assertSliderFill();
    assert.equal(number.value, '1.24');

    number.value = '2.37';
    assert.equal(ui.speedButton.textContent, '1.24x');
    number.dispatchEvent('change');
    assert.equal(ui.speedButton.textContent, '2.37x');
    assertSliderFill();

    number.value = '';
    number.dispatchEvent('change');
    assert.equal(number.value, '2.37');
    number.value = '5';
    number.dispatchEvent('change');
    assert.equal(number.value, '2.37');

    slider.dispatchEvent('keydown', { key: 'Home', preventDefault() {} });
    assert.equal(ui.speedButton.textContent, '0.25x');
    slider.dispatchEvent('keydown', { key: 'End', preventDefault() {} });
    assert.equal(ui.speedButton.textContent, '4x');

    documentRef.dispatchEvent('pointerdown', { target: ui.speedButton });
    assert.equal(ui.playerPopup, popup);
    ui.speedButton.click();
    assert.equal(ui.playerPopup, null);
    assert.equal(ui.speedButton.getAttribute('aria-expanded'), 'false');
    assert.equal(documentRef.activeElement, ui.speedButton);

    ui.speedButton.click();
    const reopenedSlider = ui.playerPopup.querySelector('.player-speed-slider');
    assert.equal(reopenedSlider.value, '4000');
    assert.equal(reopenedSlider.style['--et-range-fill'], '100%');
    documentRef.dispatchEvent('pointerdown', { target: documentRef.body });
    assert.equal(ui.playerPopup, null);

    ui.speedButton.click();
    documentRef.dispatchEvent('keydown', { key: 'Escape', preventDefault() {} });
    assert.equal(ui.playerPopup, null);
    ui.removeUI();
    assert.equal(documentRef.eventListeners.get('pointerdown')?.length, 0);
  });
});

test('speed popup preserve-pitch toggle follows state outside the presets', async () => {
  await withAudioPlayerGlobals({ windowOptions: { uiManager: false } }, async ({ calls }) => {
    const player = createAudioPlayer(calls, { state: { playbackSpeed: 1, preservePitch: true } });
    const ui = new AudioPlayerUI(player);
    player.playbackManager.setPlaybackSpeed = speed => {
      player.stateManager.setState({ playbackSpeed: speed });
      ui.updatePlayerUIState();
    };
    player.playbackManager.togglePreservePitch = () => {
      calls.push(['togglePreservePitch']);
      player.stateManager.setState({ preservePitch: !player.stateManager.getStateSnapshot().preservePitch });
      ui.updatePlayerUIState();
    };
    ui.createPlayerUI();
    ui.speedButton.click();
    const popup = ui.playerPopup;
    const presets = popup.querySelector('.player-speed-presets');
    const pitch = popup.querySelector('.player-speed-pitch');

    assert.equal(presets.children.length, 9);
    assert.equal(presets.children.includes(pitch), false);
    assert.equal(pitch.textContent, 'Preserve Pitch');
    assert.equal(pitch.title, 'Preserve Pitch');
    assert.equal(pitch.getAttribute('aria-pressed'), 'true');

    pitch.click();
    assert.deepEqual(calls.filter(call => call[0] === 'togglePreservePitch'), [['togglePreservePitch']]);
    assert.equal(ui.playerPopup, popup);
    assert.equal(pitch.getAttribute('aria-pressed'), 'false');

    presets.children[4].click();
    assert.equal(pitch.getAttribute('aria-pressed'), 'false');

    ui.speedButton.click();
    ui.speedButton.click();
    assert.equal(ui.playerPopup.querySelector('.player-speed-pitch').getAttribute('aria-pressed'), 'false');
    ui.removeUI();
  });
});

test('speed popup opens in mini and mobile player layouts', async () => {
  for (const options of [
    { windowOptions: { electronAPI: {}, uiManager: { miniPlayerMode: true } } },
    { documentOptions: { mobilePlayerView: true }, windowOptions: { uiManager: { layoutMode: { isMobile: true } } } }
  ]) {
    await withAudioPlayerGlobals(options, async ({ calls }) => {
      const ui = new AudioPlayerUI(createAudioPlayer(calls));
      ui.createPlayerUI();
      ui.speedButton.click();
      assert.equal(ui.playerPopup?.querySelector('.player-speed-presets').children.length, 9);
      assert.ok(ui.playerPopup?.querySelector('.player-speed-slider'));
      assert.ok(ui.playerPopup?.querySelector('.player-speed-number'));
      ui.removeUI();
    });
  }
});

test('logarithmic speed slider can select every 0.01x speed', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createAudioPlayer(calls, { state: { playbackSpeed: 1 } });
    const ui = new AudioPlayerUI(player);
    player.playbackManager.setPlaybackSpeed = speed => {
      player.stateManager.setState({ playbackSpeed: speed });
      ui.updatePlayerUIState();
    };
    ui.createPlayerUI();
    ui.speedButton.click();
    const slider = ui.playerPopup.querySelector('.player-speed-slider');

    for (let hundredths = 25; hundredths <= 400; hundredths++) {
      const speed = hundredths / 100;
      slider.value = String(Math.round(Math.log(speed / 0.25) / Math.log(16) * 4000));
      slider.dispatchEvent('input');
      assert.equal(player.stateManager.getStateSnapshot().playbackSpeed, speed);
    }

    ui.removeUI();
  });
});

test('Electron player controls follow mini mode and always-on-top state', async () => {
  await withAudioPlayerGlobals({
    windowOptions: {
      electronAPI: {},
      uiManager: {
        miniPlayerMode: true,
        miniPlayerAlwaysOnTop: true,
        toggleMiniPlayer() { this.calls.push(['toggleMiniPlayer']); },
        setMiniPlayerAlwaysOnTop(enabled) { this.calls.push(['setMiniPlayerAlwaysOnTop', enabled]); },
        calls: []
      }
    }
  }, async ({ calls, windowRef }) => {
    windowRef.uiManager.calls = calls;
    const ui = new AudioPlayerUI(createAudioPlayer(calls));
    const container = ui.createPlayerUI();

    assert.equal(container.getAttribute('data-mini-player'), 'true');
    assert.equal(container.getAttribute('data-expanded'), 'false');
    assert.ok(ui.miniPlayerButton);
    assert.ok(ui.restoreButton);
    assert.ok(ui.pinButton);
    assert.equal(ui.pinButton.getAttribute('aria-pressed'), 'true');
    assert.equal(ui.pinButton.getAttribute('data-active'), 'true');
    ui.setMiniPlayerAlwaysOnTop(false);
    assert.equal(ui.pinButton.getAttribute('aria-pressed'), 'false');
    assert.equal(ui.pinButton.getAttribute('data-active'), 'false');
    ui.setMiniPlayerAlwaysOnTop(true);
    assert.equal(ui.artworkImage.parentNode.style.display, '');
    assert.equal(container.getAttribute('data-artwork-layout'), 'true');

    ui.restoreButton.dispatchEvent('click');
    ui.pinButton.dispatchEvent('click');
    assert.deepEqual(calls.filter(call => call[0] === 'toggleMiniPlayer' || call[0] === 'setMiniPlayerAlwaysOnTop'), [
      ['toggleMiniPlayer'],
      ['setMiniPlayerAlwaysOnTop', false]
    ]);
  });
});

test('mountContainerForLayout moves an existing player between mobile and desktop roots', async () => {
  await withAudioPlayerGlobals({
    documentOptions: { mobilePlayerView: true },
    windowOptions: {
      uiManager: {
        layoutMode: { isMobile: true },
        mobileNav: {
          updatePlayerPlaceholder() {}
        }
      }
    }
  }, async ({ documentRef, calls, windowRef }) => {
    const ui = new AudioPlayerUI(createAudioPlayer(calls));
    const container = ui.createPlayerUI();

    assert.equal(container.parentNode, documentRef.mobilePlayerView);
    assert.equal(documentRef.mobilePlayerView.children.includes(container), true);

    windowRef.uiManager.layoutMode.isMobile = false;
    ui.mountContainerForLayout('desktop');
    assert.equal(container.parentNode, documentRef.body);
    assert.equal(container.nextSibling, documentRef.mainContainer);
    assert.equal(documentRef.mobilePlayerView.children.includes(container), false);

    windowRef.uiManager.layoutMode.isMobile = true;
    ui.mountContainerForLayout('mobile');
    assert.equal(container.parentNode, documentRef.mobilePlayerView);
    assert.equal(documentRef.body.children.includes(container), false);
  });
});

test('updatePlayerUIState handles repeat, shuffle, default, and missing-control states', () => {
  const calls = [];
  const player = createAudioPlayer(calls, {
    state: { repeatMode: 'ALL', shuffleMode: true }
  });
  const ui = new AudioPlayerUI(player);

  ui.updatePlayerUIState();

  ui.repeatButton = createControlElement(calls, 'repeat-button');
  ui.shuffleButton = createControlElement(calls, 'shuffle-button');
  ui.speedButton = createControlElement(calls, 'speed-button');

  ui.updatePlayerUIState();
  assert.equal(ui.repeatButton.attributes.get('data-active'), 'true');
  assert.equal(ui.shuffleButton.attributes.get('data-active'), 'true');
  assert.equal(ui.speedButton.textContent, '1x');
  assert.equal(ui.speedButton.attributes.get('data-active'), 'false');

  player.stateManager.setState({ playbackSpeed: 1.25 });
  ui.updatePlayerUIState();
  assert.equal(ui.speedButton.textContent, '1.25x');
  assert.equal(ui.speedButton.attributes.get('data-active'), 'true');

  player.stateManager.setState({ repeatMode: 'ONE', shuffleMode: true });
  ui.updatePlayerUIState();
  assert.match(ui.repeatButton.innerHTML, /M11\.3 10\.3/);
  assert.equal(ui.repeatButton.attributes.get('data-active'), 'true');
  assert.equal(ui.shuffleButton.disabled, true);
  assert.equal(ui.shuffleButton.style.opacity, '0.5');
  assert.equal(ui.shuffleButton.attributes.get('data-active'), 'false');

  player.stateManager.setState({ repeatMode: 'OFF', shuffleMode: false });
  ui.updatePlayerUIState();
  assert.equal(ui.repeatButton.attributes.get('data-active'), 'false');
  assert.equal(ui.shuffleButton.disabled, false);
  assert.equal(ui.shuffleButton.style.opacity, '1');
  assert.equal(ui.shuffleButton.attributes.get('data-active'), 'false');

  player.stateManager.setState({ repeatMode: 'UNEXPECTED', shuffleMode: true });
  ui.updatePlayerUIState();
  assert.equal(ui.repeatButton.attributes.get('data-active'), 'false');
  assert.equal(ui.shuffleButton.attributes.get('data-active'), 'true');

  const fallbackUI = new AudioPlayerUI(createAudioPlayer(calls, { stateManager: false }));
  fallbackUI.repeatButton = createControlElement(calls, 'repeat-button');
  fallbackUI.shuffleButton = createControlElement(calls, 'shuffle-button');
  fallbackUI.updatePlayerUIState();
  assert.equal(fallbackUI.repeatButton.attributes.get('data-active'), 'false');
  assert.equal(fallbackUI.shuffleButton.disabled, false);
  assert.equal(fallbackUI.shuffleButton.attributes.get('data-active'), 'false');
});

test('playback pending state selects the artwork overlay or compact track-name spinner for the active layout', async () => {
  await withAudioPlayerGlobals({
    windowOptions: { uiManager: { layoutMode: { isMobile: false } } }
  }, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: { isPlaybackPending: true, artworkUrl: '' }
    });
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();

    assert.equal(container.attributes.get('data-loading'), 'true');
    assert.equal(container.attributes.get('data-artwork-layout'), 'false');
    assert.ok(container.querySelector('.player-loading-spinner-artwork'));
    assert.ok(container.querySelector('.player-loading-spinner-inline'));

    ui.updateArtwork('blob:artwork');
    assert.equal(container.attributes.get('data-artwork-layout'), 'true');

    player.stateManager.setState({ isPlaybackPending: false });
    player.stateManager.emit('isPlaybackPending', false);
    assert.equal(container.attributes.get('data-loading'), 'false');
  });
});

test('mobile track changes keep the previous presentation until artwork is ready', async () => {
  const preloaders = [];
  class FakeImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      preloaders.push(this);
    }

    set src(value) {
      this._src = value;
    }

    get src() {
      return this._src;
    }
  }

  await withAudioPlayerGlobals({
    Image: FakeImage,
    documentOptions: { mobilePlayerView: true },
    windowOptions: {
      uiManager: {
        layoutMode: { isMobile: true },
        mobileNav: { updatePlayerPlaceholder() {} }
      }
    }
  }, async ({ calls }) => {
    const oldTrack = { name: 'Old track' };
    const newTrack = { name: 'New track' };
    const noArtworkTrack = { name: 'No artwork track' };
    const player = createAudioPlayer(calls, {
      state: {
        currentTrack: oldTrack,
        currentTrackName: 'Old Artist - Old Title',
        artworkUrl: 'blob:old-artwork',
        isTrackPresentationPending: false
      }
    });
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    assert.equal(ui.trackNameDisplay.textContent, 'Old Artist - Old Title');
    assert.equal(ui.artworkImage.src, 'blob:old-artwork');

    player.stateManager.setState({
      currentTrack: newTrack,
      currentTrackName: 'New track',
      artworkUrl: '',
      isTrackPresentationPending: true
    });
    player.stateManager.emit('currentTrack', newTrack);
    player.stateManager.emit('currentTrackName', 'New track');
    player.stateManager.emit('artworkUrl', '');
    player.stateManager.emit('isTrackPresentationPending', true);

    assert.equal(ui.trackNameDisplay.textContent, 'Old Artist - Old Title');
    assert.equal(ui.artworkImage.src, 'blob:old-artwork');

    player.stateManager.setState({
      currentTrackName: 'New Artist - New Title',
      artworkUrl: 'blob:new-artwork',
      isTrackPresentationPending: false
    });
    player.stateManager.emit('currentTrackName', 'New Artist - New Title');
    player.stateManager.emit('artworkUrl', 'blob:new-artwork');
    player.stateManager.emit('isTrackPresentationPending', false);

    assert.equal(preloaders.length, 1);
    assert.equal(preloaders[0].src, 'blob:new-artwork');
    assert.equal(ui.trackNameDisplay.textContent, 'Old Artist - Old Title');
    assert.equal(ui.artworkImage.src, 'blob:old-artwork');

    preloaders[0].onload();
    assert.equal(ui.trackNameDisplay.textContent, 'New Artist - New Title');
    assert.equal(ui.artworkImage.src, 'blob:new-artwork');

    player.stateManager.setState({
      currentTrack: noArtworkTrack,
      currentTrackName: 'No Artwork Artist - No Artwork Title',
      artworkUrl: '',
      isTrackPresentationPending: true
    });
    player.stateManager.emit('currentTrack', noArtworkTrack);
    player.stateManager.emit('artworkUrl', '');
    player.stateManager.emit('isTrackPresentationPending', true);
    assert.equal(ui.artworkImage.src, 'blob:new-artwork');

    player.stateManager.setState({ isTrackPresentationPending: false });
    player.stateManager.emit('isTrackPresentationPending', false);
    assert.equal(ui.trackNameDisplay.textContent, 'No Artwork Artist - No Artwork Title');
    assert.equal(ui.artworkImage.src, '');
    assert.equal(ui.artworkImage.hidden, true);
  });
});

test('desktop track changes keep the previous artwork until the replacement is decoded', async () => {
  const preloaders = [];
  class FakeImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      preloaders.push(this);
    }

    set src(value) {
      this._src = value;
    }

    get src() {
      return this._src;
    }
  }

  await withAudioPlayerGlobals({
    Image: FakeImage,
    windowOptions: { uiManager: { layoutMode: { isMobile: false } } }
  }, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: {
        currentTrack: { name: 'Old track' },
        currentTrackName: 'Old Artist - Old Title',
        artworkUrl: 'blob:old-artwork',
        isTrackPresentationPending: false
      }
    });
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    assert.equal(ui.artworkImage.src, 'blob:old-artwork');
    assert.equal(preloaders.length, 0, 'initial state render applies directly');

    // Track change: pending starts and the transient empty URL must not
    // clear the visible artwork.
    player.stateManager.setState({ isTrackPresentationPending: true, artworkUrl: '' });
    player.stateManager.emit('isTrackPresentationPending', true);
    player.stateManager.emit('artworkUrl', '');
    assert.equal(ui.artworkImage.src, 'blob:old-artwork');
    assert.equal(ui.artworkImage.hidden, false);

    // New artwork resolves: swap only after the preloaded image is ready.
    player.stateManager.setState({ artworkUrl: 'blob:new-artwork', isTrackPresentationPending: false });
    player.stateManager.emit('artworkUrl', 'blob:new-artwork');
    player.stateManager.emit('isTrackPresentationPending', false);
    assert.equal(preloaders.length, 1, 'pending=false must not restart the same preload');
    assert.equal(preloaders[0].src, 'blob:new-artwork');
    assert.equal(ui.artworkImage.src, 'blob:old-artwork');

    // Playback commits re-publish currentTrack (same value) while the image
    // is still decoding; that churn must not drop the pending swap.
    player.stateManager.emit('currentTrack', player.stateManager.state.currentTrack);
    assert.equal(ui.pendingArtworkPreload, preloaders[0], 'currentTrack churn must not cancel the preload');

    preloaders[0].onload();
    assert.equal(ui.artworkImage.src, 'blob:new-artwork');
    assert.equal(ui.artworkImage.hidden, false);

    // A track without artwork settles on the placeholder in one step.
    player.stateManager.setState({ isTrackPresentationPending: true, artworkUrl: '' });
    player.stateManager.emit('isTrackPresentationPending', true);
    player.stateManager.emit('artworkUrl', '');
    assert.equal(ui.artworkImage.src, 'blob:new-artwork');

    player.stateManager.setState({ isTrackPresentationPending: false, artworkUrl: '' });
    player.stateManager.emit('artworkUrl', '');
    player.stateManager.emit('isTrackPresentationPending', false);
    assert.equal(ui.artworkImage.src, '');
    assert.equal(ui.artworkImage.hidden, true);
    assert.equal(preloaders.length, 1, 'empty artwork never preloads');
  });
});

test('desktop loading indicator follows playback pending state immediately', async () => {
  await withAudioPlayerGlobals({
    windowOptions: { uiManager: { layoutMode: { isMobile: false } } }
  }, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: { isPlaybackPending: false }
    });
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    assert.equal(container.attributes.get('data-loading'), 'false');

    player.stateManager.setState({ isPlaybackPending: true });
    player.stateManager.emit('isPlaybackPending', true);
    assert.equal(container.attributes.get('data-loading'), 'true');

    player.stateManager.setState({ isPlaybackPending: false });
    player.stateManager.emit('isPlaybackPending', false);
    assert.equal(container.attributes.get('data-loading'), 'false');
  });
});

test('desktop remount cancels pending mobile presentation and shows current track', async () => {
  const preloaders = [];
  class FakeImage {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      preloaders.push(this);
    }

    set src(value) {
      this._src = value;
    }

    get src() {
      return this._src;
    }
  }

  const uiManager = {
    layoutMode: { isMobile: true },
    mobileNav: { updatePlayerPlaceholder() {} },
    releaseAudioPlayerLayoutPlaceholder() {}
  };

  await withAudioPlayerGlobals({
    Image: FakeImage,
    documentOptions: { mobilePlayerView: true },
    windowOptions: { uiManager }
  }, async () => {
    const oldTrack = { name: 'Old track' };
    const newTrack = { name: 'New track' };
    const player = createAudioPlayer([], {
      state: {
        currentTrack: oldTrack,
        currentTrackName: 'Old Artist - Old Title',
        artworkUrl: 'blob:old-artwork',
        isTrackPresentationPending: false
      }
    });
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    player.stateManager.setState({
      currentTrack: newTrack,
      currentTrackName: 'New Artist - New Title',
      artworkUrl: 'blob:new-artwork',
      isTrackPresentationPending: false
    });
    player.stateManager.emit('currentTrack', newTrack);
    player.stateManager.emit('currentTrackName', 'New Artist - New Title');
    player.stateManager.emit('artworkUrl', 'blob:new-artwork');
    player.stateManager.emit('isTrackPresentationPending', false);

    assert.equal(preloaders.length, 1);
    assert.equal(ui.trackNameDisplay.textContent, 'Old Artist - Old Title');

    uiManager.layoutMode.isMobile = false;
    ui.mountContainerForLayout('desktop');

    assert.equal(ui.trackNameDisplay.textContent, 'New Artist - New Title');
    assert.equal(ui.artworkImage.src, 'blob:new-artwork');
    preloaders[0].onload?.();
    assert.equal(ui.trackNameDisplay.textContent, 'New Artist - New Title');
    assert.equal(ui.artworkImage.src, 'blob:new-artwork');
  });
});

test('seek bar input respects disabled state and context manager duration validity', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const contextState = { currentTrackDuration: 100 };
    const contextManager = {
      getCurrentState() {
        calls.push(['getCurrentState']);
        return contextState;
      },
      seek(value) {
        calls.push(['seek', value]);
      }
    };
    const player = createAudioPlayer(calls, {
      contextManager,
      state: {
        seekBarEnabled: false,
        currentTrackPosition: 0,
        currentTrackDuration: 100
      }
    });
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    ui.seekBar.value = '50';
    ui.seekBar.dispatchEvent('input');
    assert.equal(calls.some(call => call[0] === 'seek'), false);

    player.stateManager.setState({ seekBarEnabled: true });
    ui.seekBar.dispatchEvent('input');
    assert.ok(calls.some(call => call[0] === 'seek' && call[1] === 50));
    assert.ok(calls.findIndex(call => call[0] === 'resumeAudioContextInGesture') <
      calls.findIndex(call => call[0] === 'seek'));

    contextState.currentTrackDuration = 0;
    ui.seekBar.dispatchEvent('input');
    assert.equal(calls.filter(call => call[0] === 'seek').length, 1);

    contextState.currentTrackDuration = Infinity;
    ui.seekBar.dispatchEvent('input');
    assert.equal(calls.filter(call => call[0] === 'seek').length, 1);
  });

  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const contextManager = {
      getCurrentState() {
        return { currentTrackDuration: 80 };
      },
      seek(value) {
        calls.push(['seekWithoutState', value]);
      }
    };
    const ui = new AudioPlayerUI(createAudioPlayer(calls, {
      stateManager: false,
      contextManager
    }));
    ui.createPlayerUI();
    ui.seekBar.value = '25';
    ui.seekBar.dispatchEvent('input');

    assert.deepEqual(calls.filter(call => call[0] === 'seekWithoutState'), [['seekWithoutState', 20]]);
  });
});

test('seek bar input uses audio-element fallback paths', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: { seekBarEnabled: true },
      audioElement: { duration: 0, paused: false }
    });
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    ui.seekBar.value = '50';
    ui.seekBar.dispatchEvent('input');

    player.audioElement = { duration: Infinity, paused: false };
    ui.seekBar.dispatchEvent('input');

    player.audioElement = { duration: 60, paused: true };
    ui.seekBar.dispatchEvent('input');

    player.audioElement = { duration: 60, paused: false };
    assert.throws(() => ui.seekBar.dispatchEvent('input'), TypeError);
  });
});

test('display updates handle fallbacks, invalid values, and warning paths', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: {
        currentTrack: { name: 'Snapshot track' },
        currentTrackPosition: -5,
        currentTrackDuration: Infinity
      }
    });
    const ui = new AudioPlayerUI(player);

    ui.updatePlayPauseButton();
    ui.updateTrackDisplay();
    ui.updateTimeDisplay();
    assert.ok(calls.some(call => call[0] === 'warn' && call[1].includes('Time display')));

    ui.playPauseButton = createControlElement(calls, 'play-pause-button');
    ui.trackNameDisplay = createControlElement(calls, 'track-name');
    ui.timeDisplay = createControlElement(calls, 'time-display');
    ui.seekBar = createControlElement(calls, 'seek-bar');
    ui.seekBar.value = '77';

    ui.updateTrackDisplay();
    assert.equal(ui.trackNameDisplay.textContent, 'Snapshot track');

    ui.updateTrackDisplay({ name: 'Explicit track' });
    assert.equal(ui.trackNameDisplay.textContent, 'Explicit track');

    ui.updateTrackDisplay({ name: '' });
    assert.equal(ui.trackNameDisplay.textContent, 'No track loaded');

    ui.updateTimeDisplay();
    assert.equal(ui.timeDisplay.textContent, '00:00 / 00:00');
    assert.equal(ui.seekBar.value, 0);

    player.stateManager.setState({ currentTrackPosition: 0, currentTrackDuration: undefined });
    ui.seekBar.value = '33';
    ui.updateTimeDisplay();
    assert.equal(ui.timeDisplay.textContent, '00:00 / 00:00');
    assert.equal(ui.seekBar.value, 0);

    player.stateManager.setState({ currentTrackPosition: Infinity, currentTrackDuration: 0 });
    ui.seekBar.value = '44';
    ui.updateTimeDisplay();
    assert.equal(ui.timeDisplay.textContent, '00:00 / 00:00');
    assert.equal(ui.seekBar.value, 0);

    player.stateManager.setState({ currentTrackPosition: 30, currentTrackDuration: 120 });
    ui.updateTimeDisplay();
    assert.equal(ui.timeDisplay.textContent, '00:30 / 02:00');
    assert.equal(ui.seekBar.value, 25);

    player.stateManager.setState({ currentTrackPosition: 150, currentTrackDuration: 120 });
    ui.seekBar.value = 25;
    ui.updateTimeDisplay();
    assert.equal(ui.seekBar.value, 25);

    player.stateManager.setState({ isPlaying: true });
    ui.updatePlayPauseButton();
    assert.match(ui.playPauseButton.innerHTML, /<rect x="7"/);

    player.stateManager.setState({ isPlaying: false });
    ui.updatePlayPauseButton();
    assert.match(ui.playPauseButton.innerHTML, /M8 5\.14/);

    assert.equal(ui.formatTime(Number.NaN), '00:00');
    assert.equal(ui.formatTime(125), '02:05');
  });

  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const ui = new AudioPlayerUI(createAudioPlayer(calls, { stateManager: false }));
    ui.playPauseButton = createControlElement(calls, 'play-pause-button');
    ui.timeDisplay = createControlElement(calls, 'time-display');
    ui.seekBar = createControlElement(calls, 'seek-bar');
    ui.trackNameDisplay = createControlElement(calls, 'track-name');

    ui.updatePlayPauseButton();
    ui.updateTimeDisplay();
    ui.updateTrackDisplay();

    assert.ok(calls.some(call => call[0] === 'warn' && call[1].includes('StateManager not available for updatePlayPauseButton')));
    assert.ok(calls.some(call => call[0] === 'warn' && call[1].includes('StateManager not available for updateTimeDisplay')));
    assert.equal(ui.trackNameDisplay.textContent, 'No track loaded');
  });
});

test('playlist display syncs active track and delegates mobile taps to shared queue selection', async () => {
  await withAudioPlayerGlobals({
    windowOptions: {
      uiManager: {
        layoutMode: { isMobile: true }
      }
    }
  }, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: {
        playlist: [
          { name: 'One', path: '/one.wav' },
          { name: 'Two', path: '/two.wav' }
        ],
        currentTrackIndex: 1,
        currentTrack: { name: 'Two', path: '/two.wav' },
        currentBuffer: { id: 'buffer-two' },
        currentTrackPosition: 8,
        isPlaying: false,
        isPaused: true,
        isStopped: false
      }
    });
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    assert.equal(ui.playlistDisplay.parentNode.classList().includes('player-controls'), true);
    assert.equal(ui.playlistDisplay.children.length, 2);
    assert.match(ui.playlistDisplay.children[1].className, /active/);

    await Promise.all(ui.playlistDisplay.children[0].dispatchEvent('click'));
    assert.deepEqual(calls.find(call => call[0] === 'selectQueueOrdinal'), [
      'selectQueueOrdinal',
      0,
      { play: true, userInitiated: true, preserveQueueWindow: false }
    ]);
  });
});

test('moving the active playlist track scrolls only the queue without rebuilding it', async () => {
  await withAudioPlayerGlobals({
    windowOptions: { uiManager: { layoutMode: { isMobile: true } } }
  }, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: {
        playlist: [
          { name: 'One', path: '/one.wav' },
          { name: 'Two', path: '/two.wav' },
          { name: 'Three', path: '/three.wav' }
        ],
        currentTrackIndex: 0,
        currentTrack: { name: 'One', path: '/one.wav' }
      }
    });
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    const renderedItems = [...ui.playlistDisplay.children];
    ui.playlistDisplay.rect = { top: 100, bottom: 200 };
    ui.playlistDisplay.scrollTop = 40;
    renderedItems[2].rect = { top: 210, bottom: 230 };
    container.scrollTop = 17;
    calls.length = 0;

    player.stateManager.setState({
      currentTrackIndex: 2,
      currentTrack: player.stateManager.state.playlist[2]
    });
    player.stateManager.emit('currentTrackIndex', 2);

    assert.deepEqual(ui.playlistDisplay.children, renderedItems);
    assert.equal(renderedItems[0].classList().includes('active'), false);
    assert.equal(renderedItems[2].classList().includes('active'), true);
    assert.equal(ui.playlistDisplay.scrollTop, 70);
    assert.equal(container.scrollTop, 17);
    assert.equal(calls.some(call => call[0] === 'scrollIntoView'), false);
  });
});

test('expanding the desktop queue reveals the active track inside the queue', async () => {
  await withAudioPlayerGlobals({
    windowOptions: { uiManager: { layoutMode: { isMobile: false } } }
  }, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: {
        playlist: [
          { name: 'One', path: '/one.wav' },
          { name: 'Two', path: '/two.wav' }
        ],
        currentTrackIndex: 1,
        currentTrack: { name: 'Two', path: '/two.wav' }
      }
    });
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    ui.playlistDisplay.rect = { top: 100, bottom: 200 };
    ui.playlistDisplay.scrollTop = 10;
    ui.playlistDisplay.children[1].rect = { top: 215, bottom: 235 };
    container.scrollTop = 23;
    calls.length = 0;

    ui.setDesktopQueueExpanded(true);

    assert.equal(container.getAttribute('data-expanded'), 'true');
    assert.equal(ui.playlistDisplay.scrollTop, 45);
    assert.equal(container.scrollTop, 23);
    assert.equal(calls.some(call => call[0] === 'scrollIntoView'), false);
  });
});

test('catalog queue renders a bounded page with reachable previous and next navigation', async () => {
  await withAudioPlayerGlobals({
    windowOptions: { uiManager: { layoutMode: { isMobile: false } } }
  }, async ({ calls, documentRef }) => {
    const pageRequests = [];
    const selections = [];
    const player = createAudioPlayer(calls, {
      state: {
        sequenceKind: 'catalog',
        playlistLength: 1_000_000,
        currentTrackIndex: 200,
        queueWindow: {
          startOrdinal: 160,
          totalCount: 1_000_000,
          rows: Array.from({ length: 80 }, (_, index) => ({
            entryInstanceId: `entry-${160 + index}`,
            trackUid: `track-${160 + index}`,
            title: `Track ${160 + index}`,
            artist: 'Catalog Artist'
          }))
        }
      }
    });
    player.playbackManager.refreshCatalogQueuePage = ordinal => pageRequests.push(ordinal);
    player.playbackManager.selectQueueOrdinal = (ordinal, options) => {
      selections.push({ ordinal, options });
    };
    const ui = new AudioPlayerUI(player);
    ui.playlistDisplay = documentRef.createElement('div');
    ui.renderCatalogQueueWindow(player.stateManager.getStateSnapshot());

    assert.equal(ui.playlistDisplay.children.length, 81);
    const navigation = ui.playlistDisplay.children[0];
    assert.equal(navigation.className, 'player-queue-pagination');
    assert.equal(navigation.children[1].textContent, '161–240 / 1000000');
    assert.equal(ui.playlistDisplay.children[1].textContent, 'Catalog Artist - Track 160');
    assert.equal(calls.some(call => call[0] === 'scrollIntoView'), false);
    navigation.children[0].dispatchEvent('click');
    navigation.children[2].dispatchEvent('click');
    await Promise.all(ui.playlistDisplay.children[80].dispatchEvent('click'));
    assert.deepEqual(pageRequests, [80, 240]);
    assert.deepEqual(selections, [{
      ordinal: 239,
      options: {
        play: true,
        userInitiated: true,
        preserveQueueWindow: true
      }
    }]);

    player.stateManager.setState({ currentTrackIndex: 239 });
    ui.playlistDisplay.rect = { top: 100, bottom: 300 };
    navigation.rect = { top: 100, bottom: 142 };
    ui.playlistDisplay.children[80].rect = { top: 290, bottom: 320 };
    player.stateManager.emit('currentTrackIndex', 239);
    assert.equal(ui.playlistDisplay.scrollTop, 20);

    player.stateManager.setState({
      currentTrackIndex: 240,
      queueWindow: {
        startOrdinal: 240,
        totalCount: 1_000_000,
        rows: Array.from({ length: 80 }, (_, index) => ({
          entryInstanceId: `entry-${240 + index}`,
          trackUid: `track-${240 + index}`,
          title: `Track ${240 + index}`,
          artist: 'Catalog Artist'
        }))
      }
    });
    player.stateManager.emit('queueWindow', player.stateManager.state.queueWindow);
    assert.equal(ui.playlistDisplay.children[0].children[1].textContent, '241–320 / 1000000');
    const currentNavigation = ui.playlistDisplay.children[0];
    const currentItem = ui.playlistDisplay.children[1];
    currentNavigation.rect = { top: 100, bottom: 142 };
    currentItem.rect = { top: 120, bottom: 140 };
    ui.playlistDisplay.scrollTop = 80;
    ui.updatePlaylistActiveState();
    assert.equal(ui.playlistDisplay.scrollTop, 58);
    assert.equal(calls.some(call => call[0] === 'scrollIntoView'), false);
  });
});

test('materialized queue rows request the shared queue selection with playback', async () => {
  await withAudioPlayerGlobals({}, async ({ calls }) => {
    const player = createAudioPlayer(calls, {
      state: {
        playlist: [
          { name: 'A', path: '/a.wav' },
          { name: 'B', path: '/b.wav' }
        ],
        currentTrackIndex: 0,
        isPlaying: false,
        isStopped: true
      }
    });
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    await Promise.all(ui.playlistDisplay.children[1].dispatchEvent('click'));

    assert.deepEqual(calls.filter(call => call[0] === 'selectQueueOrdinal'), [[
      'selectQueueOrdinal',
      1,
      { play: true, userInitiated: true, preserveQueueWindow: false }
    ]]);
    assert.equal(calls.some(call => call[0] === 'stop'), false);
    assert.equal(calls.some(call => call[0] === 'loadTrack'), false);
  });
});

test('library queue helpers notify now playing and save library queues as playlists', async () => {
  const playlistCreates = [];
  const nowPlaying = [];
  const queueAdds = [];
  const selectionActions = [];
  await withAudioPlayerGlobals({
    windowOptions: {
      uiManager: {
        libraryView: {
          setNowPlayingTrack(trackId) {
            nowPlaying.push(trackId);
          }
        },
        async ensureLibraryManager() {
          return {
            playlists: {
              async create(name, trackIds) {
                playlistCreates.push([name, trackIds]);
              },
              async openListContext() { return { contextToken: 'empty-playlists' }; },
              async readListContext() { return { rows: [], nextCursor: null }; },
              async releaseListContext() {}
            },
            async addToQueue(trackIds) {
              queueAdds.push(trackIds);
            },
            async performSelectionAction(action, descriptor) {
              selectionActions.push([action, descriptor]);
            },
            findTrackForPlaybackEntry(track) {
              return track?.path === 'D:/Music/one.flac' ? { id: 'track-one' } : null;
            },
            createPlaylistItemsFromQueueEntries(entries) {
              return entries.map(track => (
                track.libraryTrackId
                  ? { trackId: track.libraryTrackId }
                  : { trackId: null, unresolved: { sourceLine: track.path || track.name, title: track.name } }
              ));
            }
          };
        }
      }
    }
  }, async ({ calls, documentRef }) => {
    const player = createAudioPlayer(calls, {
      state: {
        playlist: [
          { path: 'D:/Music/one.flac', meta: { title: 'One' } },
          { libraryTrackId: 'track-two', meta: { title: 'Two' } },
          { name: 'Loose file' }
        ],
        currentTrackIndex: 1,
        currentTrack: { libraryTrackId: 'track-two', meta: { title: 'Two' } }
      }
    });
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();

    ui.notifyLibraryNowPlaying();
    assert.deepEqual(nowPlaying, ['track-two']);

    await ui.openLibraryTrackMenu({
      preventDefault() {
        calls.push(['preventDefault']);
      },
      clientX: 20,
      clientY: 30
    }, player.stateManager.state.playlist[0]);
    assert.ok(documentRef.body.children.some(child => child.className === 'player-library-context-menu'));
    assert.ok(calls.some(call => call[0] === 'preventDefault'));

    ui.closePlayerPopup();
    await ui.openLibraryTrackMenu({ preventDefault() {}, clientX: 20, clientY: 30 }, {
      trackUid: 'catalog-track',
      title: 'Catalog Track'
    });
    const catalogMenu = documentRef.body.children.find(child => child.className === 'player-library-context-menu');
    assert.match(catalogMenu.innerHTML, /data-action="show"/);
    ui.notifyLibraryNowPlaying({ trackUid: 'catalog-track' });
    assert.deepEqual(nowPlaying, ['track-two', 'catalog-track']);

    const savePromise = ui.saveQueueAsPlaylist();
    await new Promise(resolve => setImmediate(resolve));
    const promptBackdrop = documentRef.body.children.find(child => child.classList().includes('player-prompt-backdrop'));
    assert.ok(promptBackdrop, 'expected in-app prompt dialog instead of window.prompt');
    const promptInput = promptBackdrop.querySelector('.player-prompt-input');
    assert.equal(promptInput.value, 'T:library.prompt.queuePlaylistName');
    promptInput.value = 'Saved Queue';
    promptBackdrop.querySelector('.player-prompt-dialog').dispatchEvent('submit');
    await savePromise;
    assert.equal(documentRef.body.children.includes(promptBackdrop), false);
    assert.deepEqual(playlistCreates, [['Saved Queue', [
      { trackId: null, unresolved: { sourceLine: 'D:/Music/one.flac', title: undefined } },
      { trackId: 'track-two' },
      { trackId: null, unresolved: { sourceLine: 'Loose file', title: 'Loose file' } }
    ]]]);

    let dragPrevented = 0;
    const dragOver = {
      dataTransfer: {
        types: ['application/x-effetune-library-tracks'],
        dropEffect: ''
      },
      preventDefault() {
        dragPrevented++;
      }
    };
    ui.container.dispatchEvent('dragover', dragOver);
    assert.equal(dragPrevented, 1);
    assert.equal(dragOver.dataTransfer.dropEffect, 'copy');

    let dropPrevented = 0;
    const drop = {
      dataTransfer: {
        types: ['application/x-effetune-library-tracks'],
        getData() {
          return JSON.stringify(['track-one', 'track-two']);
        }
      },
      preventDefault() {
        dropPrevented++;
      }
    };
    await Promise.all(ui.container.dispatchEvent('drop', drop));
    assert.equal(dropPrevented, 1);
    assert.deepEqual(queueAdds, [['track-one', 'track-two']]);

    const descriptor = {
      mode: 'explicit',
      contextToken: 'drag-context',
      trackUids: ['track-three', 'track-four']
    };
    await Promise.all(ui.container.dispatchEvent('drop', {
      dataTransfer: {
        types: ['application/x-effetune-library-tracks'],
        getData() {
          return JSON.stringify({ contextToken: 'drag-context', selectionDescriptor: descriptor });
        }
      },
      preventDefault() {}
    }));
    assert.deepEqual(selectionActions, [['queue', descriptor]]);
    assert.deepEqual(queueAdds, [['track-one', 'track-two']], 'durable drag payload must not fall back to legacy UID arrays');
  });
});

test('player playlist picker pages past 500 rows and starts versioned descriptor adds', async () => {
  const playlists = Array.from({ length: 501 }, (_, index) => ({
    id: `playlist-${index}`,
    name: `Playlist ${index}`,
    version: index + 1
  }));
  const listReads = [];
  const contexts = [];
  const released = [];
  const adds = [];
  const manager = {
    playlists: {
      async openListContext() { return { contextToken: 'playlist-list' }; },
      async readListContext(contextToken, { cursor, limit }) {
        listReads.push([contextToken, cursor, limit]);
        return cursor === null
          ? { rows: playlists.slice(0, 500), nextCursor: 'second-page' }
          : { rows: playlists.slice(500), nextCursor: null };
      },
      async releaseListContext(contextToken) { released.push(contextToken); },
      async create() {},
      async addTracks(playlistId, descriptor, options) {
        adds.push([playlistId, descriptor, options]);
        return { operationId: 'add-operation' };
      }
    },
    async createContext(request) {
      contexts.push(request);
      return 'track-context';
    },
    async releaseContext(contextToken) { released.push(contextToken); }
  };
  await withAudioPlayerGlobals({
    windowOptions: { uiManager: { async ensureLibraryManager() { return manager; } } }
  }, async ({ calls, documentRef }) => {
    const ui = new AudioPlayerUI(createAudioPlayer(calls, { state: { playlist: [] } }));
    ui.createPlayerUI();
    await ui.openPlayerPlaylistMenu({ preventDefault() {}, clientX: 0, clientY: 0 }, ['track-one']);
    const menu = documentRef.body.children.find(child => child.className === 'player-library-context-menu');
    const buttons = menu.querySelectorAll('[data-playlist-id]');
    assert.equal(buttons.length, 501);
    await Promise.all(buttons[500].dispatchEvent('click'));
  });

  assert.deepEqual(listReads, [
    ['playlist-list', null, 500],
    ['playlist-list', 'second-page', 500]
  ]);
  assert.deepEqual(contexts, [{
    endpoint: 'tracks', query: '', sort: 'title', direction: 'asc', scope: { trackUids: ['track-one'] }
  }]);
  assert.deepEqual(adds, [[
    'playlist-500',
    { mode: 'explicit', contextToken: 'track-context', trackUids: ['track-one'] },
    { expectedTargetVersion: 501 }
  ]]);
  assert.deepEqual(released, ['playlist-list', 'track-context']);
});

test('Save Queue passes the active disk-backed sequence descriptor without materializing rows', async () => {
  const saves = [];
  const manager = { playlists: {} };
  await withAudioPlayerGlobals({
    windowOptions: {
      uiManager: {
        async ensureLibraryManager() { return manager; },
        libraryPlaybackBridge: {
          async saveQueueAsPlaylist(request) { saves.push(request); }
        }
      }
    }
  }, async ({ calls, documentRef }) => {
    const player = createAudioPlayer(calls, { state: { playlist: [] } });
    const descriptor = {
      kind: 'composite',
      sequenceId: 'active-composite',
      itemCount: 1_000_000,
      currentOrdinal: 400_000,
      transportVersion: 12,
      segments: [{ source: { kind: 'catalog', sequenceId: 'segment-1', itemCount: 1_000_000 } }]
    };
    player.playbackManager.getActiveSequenceDescriptor = () => descriptor;
    const ui = new AudioPlayerUI(player);
    const savePromise = ui.saveQueueAsPlaylist();
    await new Promise(resolve => setImmediate(resolve));
    const promptBackdrop = documentRef.body.children.find(child => child.classList().includes('player-prompt-backdrop'));
    promptBackdrop.querySelector('.player-prompt-input').value = 'Million Queue';
    promptBackdrop.querySelector('.player-prompt-dialog').dispatchEvent('submit');
    await savePromise;
    assert.equal(saves.length, 1);
    assert.equal(saves[0].name, 'Million Queue');
    assert.equal(saves[0].sequenceDescriptor, descriptor);
    assert.equal(saves[0].libraryManager, manager);
  });
});

test('the seek bar follows the live playback clock between state updates and freezes at pause', async () => {
  await withAudioPlayerGlobals({}, async ({ calls, frames }) => {
    let playbackTime = 0;
    const player = createAudioPlayer(calls, {
      state: { isPlaying: true, currentTrackDuration: 2 },
      contextManager: { getCurrentPlaybackTime: () => playbackTime }
    });
    player.audioContext = { state: 'running' };
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();
    try {
      for (let frame = 1; frame <= 60; frame++) {
        playbackTime = frame / 60;
        frames[ui.positionRaf - 1]();
        assert.equal(ui.seekBar.value, playbackTime / 2 * 100);
      }
      assert.equal(player.stateManager.state.currentTrackPosition, 0, 'rendering does not broadcast state changes');
      assert.equal(ui.timeDisplay.textContent, '00:01 / 00:02');

      frames[ui.positionRaf - 1]();
      assert.equal(ui.seekBar.value, 50, 'a stalled clock must not be extrapolated');
      playbackTime = 0.25;
      frames[ui.positionRaf - 1]();
      assert.equal(ui.seekBar.value, 12.5, 'a backward seek is reflected on the next frame');

      player.stateManager.setState({ isPlaying: false, currentTrackPosition: 0.75 });
      player.stateManager.emit('isPlaying', false);
      assert.equal(ui.positionRaf, null);
      assert.equal(ui.seekBar.value, 37.5);
      playbackTime = 1.5;
      ui.updateTimeDisplay();
      assert.equal(ui.seekBar.value, 37.5, 'paused playback uses its saved position');

      player.stateManager.setState({ currentTrackPosition: 0.5 });
      player.stateManager.emit('currentTrackPosition', 0.5);
      assert.equal(ui.seekBar.value, 25, 'seeking while paused updates the display without an animation loop');
      player.stateManager.setState({ isPlaying: true });
      player.stateManager.emit('isPlaying', true);
      frames[ui.positionRaf - 1]();
      assert.equal(ui.seekBar.value, 75);
    } finally {
      ui.removeUI();
    }
  });
});

test('position animation stops while hidden, power-disabled, or suspended and resumes without duplicate frames', async () => {
  await withAudioPlayerGlobals({}, async ({ calls, documentRef, frames }) => {
    const player = createAudioPlayer(calls, { state: { isPlaying: true, currentTrackDuration: 2 } });
    player.audioContext = { state: 'running' };
    const ui = new AudioPlayerUI(player);
    ui.createPlayerUI();
    try {
      const initialFrame = ui.positionRaf;
      ui.refreshPowerUiScheduling();
      player.stateManager.emit('currentTrackPosition', 0);
      assert.equal(ui.positionRaf, initialFrame);
      assert.equal(frames.length, 1);

      documentRef.hidden = true;
      ui.onVisibilityChange();
      assert.equal(ui.positionRaf, null);
      assert.ok(calls.some(call => call[0] === 'cancelAnimationFrame' && call[1] === initialFrame));
      documentRef.hidden = false;
      ui.onVisibilityChange();
      assert.notEqual(ui.positionRaf, null);

      ui.setPowerUiEnabled(false);
      assert.equal(ui.positionRaf, null);
      player.stateManager.emit('currentTrackPosition', 1);
      assert.equal(ui.positionRaf, null);
      ui.setPowerUiEnabled(true);
      assert.notEqual(ui.positionRaf, null);

      player.audioContext.state = 'suspended';
      frames[ui.positionRaf - 1]();
      assert.equal(ui.positionRaf, null);
      player.audioContext.state = 'running';
      ui.setPowerUiEnabled(true);
      assert.notEqual(ui.positionRaf, null);
    } finally {
      ui.removeUI();
    }
  });
});

test('removeUI cancels position animation and cleans up DOM nodes and references', async () => {
  await withAudioPlayerGlobals({}, async ({ calls, documentRef, frames, timers }) => {
    const player = createAudioPlayer(calls, { state: { isPlaying: true } });
    player.audioContext = { state: 'running' };
    const ui = new AudioPlayerUI(player);
    const container = ui.createPlayerUI();
    const pendingFrame = ui.positionRaf;
    assert.notEqual(pendingFrame, null);
    assert.equal(timers.size, 0, 'position animation needs no polling interval');

    ui.removeUI();
    assert.equal(ui.positionRaf, null);
    assert.ok(calls.some(call => call[0] === 'cancelAnimationFrame' && call[1] === pendingFrame));
    const frameCountAfterRemove = frames.length;
    const warningCountAfterRemove = calls.filter(call =>
      call[0] === 'warn' && call[1].includes('Time display')
    ).length;
    player.stateManager.emit('currentTrackPosition', 1);
    player.stateManager.emit('isStopped', true);
    assert.equal(frames.length, frameCountAfterRemove);
    assert.equal(calls.filter(call =>
      call[0] === 'warn' && call[1].includes('Time display')
    ).length, warningCountAfterRemove);
    assert.equal(calls.filter(call => call[0] === 'removeListener').length, 16);
    assert.equal(documentRef.body.children.includes(container), false);
    assert.equal(ui.container, null);
    assert.equal(ui.trackNameDisplay, null);
    assert.equal(ui.seekBar, null);
    assert.equal(ui.timeDisplay, null);
    assert.equal(ui.playPauseButton, null);
    assert.equal(ui.stopButton, null);
    assert.equal(ui.prevButton, null);
    assert.equal(ui.nextButton, null);
    assert.equal(ui.repeatButton, null);
    assert.equal(ui.shuffleButton, null);
    assert.equal(ui.closeButton, null);
    assert.equal(ui.artworkImage, null);
    assert.equal(ui.playlistDisplay, null);

    ui.removeUI();
  });
});
