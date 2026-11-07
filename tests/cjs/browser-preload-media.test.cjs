const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { loadFreshModule, withModuleLoadStub, withPatchedProperty } = require('../helpers/cjs-module-utils.cjs');

function loadWatcher() {
  const scripts = [];
  const ipcSends = [];
  const electron = {
    contextBridge: { executeInMainWorld(value) { scripts.push(value); } },
    ipcRenderer: { send: (...args) => ipcSends.push(args), sendSync: () => false }
  };
  withPatchedProperty(globalThis, 'ResizeObserver', class { observe() {} disconnect() {} }, () =>
    withPatchedProperty(globalThis, 'document', { addEventListener() {} }, () =>
      withModuleLoadStub({ electron }, () => loadFreshModule('../../electron/browser-preload.js'))));
  const script = scripts.find(item => item.func.name === 'installMediaWatcher');
  script.args[0](null);
  assert.deepEqual(ipcSends, [['browser:media', null]]);
  return script;
}

// Runs the serialized watcher in a fresh context with a controllable clock and poll.
function page() {
  const script = loadWatcher();
  const posts = [];
  const context = vm.createContext({
    location: { protocol: 'https:' },
    post: value => posts.push(JSON.parse(JSON.stringify(value)))
  });
  vm.runInContext(`
    let now = 0;
    const listeners = new Map();
    const intervals = [];
    globalThis.performance = { now: () => now };
    globalThis.setInterval = callback => intervals.push(callback);
    globalThis.document = { addEventListener(type, listener) { listeners.set(type, listener); } };
    class HTMLMediaElement {
      constructor() { Object.assign(this, { currentSrc: 'https://example.com/a.mp3', isConnected: true, muted: false, paused: true, ended: false, currentTime: 0, duration: 200, playbackRate: 1 }); }
      play() { this.paused = false; return 'played'; }
      addEventListener() {}
    }
    class MediaSession {
      metadata = null;
      playbackState = 'none';
      setPositionState(state) { if (state && state.position > state.duration) throw new TypeError('bad'); }
    }
    globalThis.HTMLMediaElement = HTMLMediaElement;
    globalThis.navigator = { mediaSession: new MediaSession() };
    globalThis.test = {
      advance(ms) { now += ms; for (const callback of intervals) callback(); },
      dispatch(type, target) { listeners.get(type)({ type, target }); }
    };
  `, context);
  vm.runInContext(`(${script.func})(post)`, context);
  return { posts, run: code => vm.runInContext(code, context) };
}

test('Media watcher posts element state, metadata changes and position jumps only', () => {
  const { posts, run } = page();
  run('test.advance(500)');
  assert.deepEqual(posts, []);
  run('globalThis.audio = new HTMLMediaElement(); audio.currentTime = 10; audio.paused = false; test.dispatch("playing", audio)');
  assert.deepEqual(posts, [{ title: '', artist: '', album: '', artwork: [], playing: true, position: 10, duration: 200, rate: 1 }]);
  // Normal playback follows the extrapolated position and is not posted again.
  run('audio.currentTime = 10.5; test.advance(500)');
  assert.equal(posts.length, 1);
  run(`navigator.mediaSession.metadata = { title: 'Song', artist: 'Artist', album: 'Album',
    artwork: [{ src: 'https://example.com/cover.jpg', sizes: '512x512', type: 'image/jpeg' }] }; test.advance(500)`);
  assert.deepEqual(posts.at(-1), { title: 'Song', artist: 'Artist', album: 'Album',
    artwork: [{ src: 'https://example.com/cover.jpg', sizes: '512x512', type: 'image/jpeg' }],
    playing: true, position: 10.5, duration: 200, rate: 1 });
  run('audio.currentTime = 60; test.dispatch("seeked", audio)');
  assert.equal(posts.length, 3);
  assert.equal(posts.at(-1).position, 60);
  run('audio.paused = true; test.dispatch("pause", audio); test.advance(500)');
  assert.equal(posts.length, 4);
  assert.equal(posts.at(-1).playing, false);
});

test('Media watcher prefers the page position state and posts null when the info is gone', () => {
  const { posts, run } = page();
  run(`navigator.mediaSession.metadata = { title: 'Stream', artist: '', album: '', artwork: [] };
    navigator.mediaSession.playbackState = 'playing';
    navigator.mediaSession.setPositionState({ duration: 300, position: 100, playbackRate: 2 })`);
  assert.deepEqual(posts, [{ title: 'Stream', artist: '', album: '', artwork: [], playing: true, position: 100, duration: 300, rate: 2 }]);
  run('test.advance(500)');
  assert.equal(posts.length, 1);
  // Element playback in the same frame does not override the page position state.
  run('globalThis.audio = new HTMLMediaElement(); audio.play(); test.dispatch("playing", audio)');
  assert.equal(posts.length, 1);
  assert.throws(() => run('navigator.mediaSession.setPositionState({ duration: 1, position: 2 })'), { name: 'TypeError' });
  run('navigator.mediaSession.setPositionState({ duration: 300, position: 10 })');
  assert.equal(posts.at(-1).position, 10);
  assert.equal(posts.at(-1).rate, 1);
  run('navigator.mediaSession.metadata = null; navigator.mediaSession.setPositionState()');
  assert.equal(posts.at(-1).position, 0);
  run('test.advance(500)');
  assert.equal(posts.length, 3);
  run('audio.currentSrc = ""; test.dispatch("emptied", audio)');
  assert.equal(posts.length, 4);
  assert.equal(posts.at(-1), null);
  run('test.advance(500)');
  assert.equal(posts.length, 4);
});

test('Media watcher keeps a paused element that plays outside the document', () => {
  const { posts, run } = page();
  run(`globalThis.audio = new HTMLMediaElement(); audio.isConnected = false; audio.currentTime = 30; audio.play();
    test.dispatch("playing", audio); audio.paused = true; test.dispatch("pause", audio)`);
  assert.deepEqual(posts.at(-1), { title: '', artist: '', album: '', artwork: [], playing: false, position: 30, duration: 200, rate: 1 });
});

test('Media watcher freezes the extrapolated session position while paused', () => {
  const { posts, run } = page();
  run(`navigator.mediaSession.metadata = { title: 'Stream' };
    navigator.mediaSession.playbackState = 'playing';
    navigator.mediaSession.setPositionState({ duration: 100, position: 10, playbackRate: 2 });
    test.advance(5000);
    navigator.mediaSession.playbackState = 'paused';
    test.advance(0);
    test.advance(10000);
    navigator.mediaSession.playbackState = 'playing';
    test.advance(0)`);
  assert.deepEqual(posts.map(({ playing, position }) => [playing, position]), [[true, 10], [false, 20], [true, 20]]);
});

test('Media watcher ignores muted elements until they are unmuted while playing', () => {
  const { posts, run } = page();
  run(`globalThis.player = new HTMLMediaElement(); player.currentTime = 5; player.play(); test.dispatch("playing", player);
    globalThis.preview = new HTMLMediaElement(); preview.muted = true; preview.duration = 15; preview.play(); test.dispatch("playing", preview)`);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].duration, 200);
  run('preview.muted = false; test.dispatch("volumechange", preview)');
  assert.equal(posts.at(-1).duration, 15);
  run('preview.muted = true; test.dispatch("volumechange", preview)');
  assert.equal(posts.at(-1), null);
});
