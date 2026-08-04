import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MediaSessionAnchor,
  createMediaSessionAnchor,
  createSilentAnchorWav,
  isMediaSessionAnchorSupported
} from '../../js/ui/audio-player/media-session-anchor.js';
import { createConsoleHarness, flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

function readAscii(view, offset, length) {
  let text = '';
  for (let index = 0; index < length; index++) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

function createStateManager(initialState = {}) {
  const listeners = new Map();
  const state = { isPlaying: false, ...initialState };
  return {
    state,
    addListener(key, listener) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
    },
    removeListener(key, listener) {
      listeners.get(key)?.delete(listener);
    },
    getStateSnapshot() {
      return { ...state };
    },
    listenerCount(key) {
      return listeners.get(key)?.size || 0;
    },
    async setPlaying(isPlaying) {
      state.isPlaying = isPlaying;
      for (const listener of listeners.get('isPlaying') || []) {
        listener(isPlaying, 'isPlaying', 'test');
      }
      await flushMicrotasks();
    }
  };
}

function createHarness(options = {}) {
  const calls = [];
  const elements = [];
  const revoked = [];
  const documentListeners = new Map();

  class TestAudio {
    constructor() {
      this.src = '';
      this.loop = false;
      this.preload = '';
      this.volume = 0;
      this.muted = true;
      this.paused = true;
      this.listeners = new Map();
      elements.push(this);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    removeEventListener(type) {
      this.listeners.delete(type);
    }

    removeAttribute(name) {
      calls.push(['removeAttribute', name]);
    }

    load() {
      calls.push(['load']);
    }

    play() {
      calls.push(['play']);
      if (options.playRejection) {
        return Promise.reject(options.playRejection);
      }
      this.paused = false;
      return Promise.resolve();
    }

    pause() {
      calls.push(['pause']);
      this.paused = true;
    }

    emitError() {
      this.listeners.get('error')?.({ type: 'error' });
    }
  }

  const stateManager = createStateManager(options.state);
  const documentRef = {
    addEventListener(type, listener) {
      calls.push(['documentAddEventListener', type]);
      documentListeners.set(type, listener);
    },
    removeEventListener(type) {
      calls.push(['documentRemoveEventListener', type]);
      documentListeners.delete(type);
    },
    dispatch(type) {
      documentListeners.get(type)?.({ type });
      documentListeners.delete(type);
    }
  };

  const windowRef = {
    navigator: {
      userAgent: options.userAgent ?? ANDROID_UA,
      mediaSession: options.mediaSession === undefined ? {} : options.mediaSession
    },
    document: documentRef,
    Audio: options.audioCtor === undefined ? TestAudio : options.audioCtor,
    Blob: options.blobCtor === undefined ? class TestBlob {
      constructor(parts, blobOptions) {
        this.parts = parts;
        this.type = blobOptions?.type || '';
      }
    } : options.blobCtor,
    URL: options.urlRef === undefined ? {
      createObjectURL(blob) {
        calls.push(['createObjectURL', blob.type]);
        if (options.createObjectUrlError) throw options.createObjectUrlError;
        return 'blob:anchor-1';
      },
      revokeObjectURL(url) {
        revoked.push(url);
      }
    } : options.urlRef
  };

  return { calls, elements, revoked, stateManager, documentRef, windowRef, TestAudio };
}

async function createAnchor(options = {}) {
  const harness = createHarness(options);
  const anchor = createMediaSessionAnchor({
    stateManager: harness.stateManager,
    windowRef: harness.windowRef,
    isElectron: options.isElectron === true,
    durationSeconds: options.durationSeconds ?? 0.01,
    sampleRate: options.sampleRate ?? 8000
  });
  await flushMicrotasks();
  return { ...harness, anchor };
}

test('silent anchor asset is a float WAV whose peak sits below a 24-bit LSB', () => {
  const sampleRate = 8000;
  const durationSeconds = 0.001;
  const buffer = createSilentAnchorWav({ sampleRate, durationSeconds });
  const view = new DataView(buffer);
  const frames = sampleRate * durationSeconds;

  assert.equal(readAscii(view, 0, 4), 'RIFF');
  assert.equal(readAscii(view, 8, 4), 'WAVE');
  assert.equal(readAscii(view, 12, 4), 'fmt ');
  assert.equal(view.getUint32(16, true), 18);
  assert.equal(view.getUint16(20, true), 3, 'IEEE float format tag');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), sampleRate);
  assert.equal(view.getUint32(28, true), sampleRate * 4);
  assert.equal(view.getUint16(32, true), 4);
  assert.equal(view.getUint16(34, true), 32);
  assert.equal(readAscii(view, 38, 4), 'fact');
  assert.equal(view.getUint32(46, true), frames);
  assert.equal(readAscii(view, 50, 4), 'data');
  assert.equal(view.getUint32(54, true), frames * 4);
  assert.equal(buffer.byteLength, 58 + frames * 4);
  assert.equal(view.getUint32(4, true), buffer.byteLength - 8);

  let peak = 0;
  let sum = 0;
  for (let frame = 0; frame < frames; frame++) {
    const sample = view.getFloat32(58 + frame * 4, true);
    peak = Math.max(peak, Math.abs(sample));
    sum += sample;
  }
  assert.equal(peak, 2 ** -24);
  assert.ok(20 * Math.log10(peak) < -144, 'peak stays below -144 dBFS');
  assert.equal(sum, 0, 'alternating sign leaves no DC offset');
});

test('anchor asset keeps at least one frame for degenerate durations', () => {
  const buffer = createSilentAnchorWav({ sampleRate: 8000, durationSeconds: 0 });
  assert.equal(buffer.byteLength, 58 + 4);
});

test('anchor is limited to non-Electron Android browsers that expose a media session', () => {
  const base = {
    navigatorRef: { userAgent: ANDROID_UA, mediaSession: {} },
    audioCtor: function TestAudio() {},
    blobCtor: function TestBlob() {},
    urlRef: { createObjectURL() {} }
  };

  assert.equal(isMediaSessionAnchorSupported(base), true);
  assert.equal(isMediaSessionAnchorSupported({ ...base, isElectron: true }), false);
  assert.equal(isMediaSessionAnchorSupported({
    ...base,
    navigatorRef: { userAgent: DESKTOP_UA, mediaSession: {} }
  }), false);
  assert.equal(isMediaSessionAnchorSupported({
    ...base,
    navigatorRef: { userAgent: ANDROID_UA }
  }), false);
  assert.equal(isMediaSessionAnchorSupported({ ...base, navigatorRef: null }), false);
  assert.equal(isMediaSessionAnchorSupported({ ...base, audioCtor: null }), false);
  assert.equal(isMediaSessionAnchorSupported({ ...base, blobCtor: null }), false);
  assert.equal(isMediaSessionAnchorSupported({ ...base, urlRef: {} }), false);
  assert.equal(isMediaSessionAnchorSupported(), false);
});

test('factory declines to build an anchor for unsupported hosts', async () => {
  const desktop = await createAnchor({ userAgent: DESKTOP_UA });
  assert.equal(desktop.anchor, null);

  const electron = await createAnchor({ isElectron: true });
  assert.equal(electron.anchor, null);

  const withoutMediaSession = await createAnchor({ mediaSession: null });
  assert.equal(withoutMediaSession.anchor, null);

  const withoutAudio = await createAnchor({ audioCtor: null });
  assert.equal(withoutAudio.anchor, null);

  assert.equal(createMediaSessionAnchor(), null);
  assert.equal(createMediaSessionAnchor({ stateManager: null }), null);
});

test('anchor stays idle until playback starts, then loops a muted-by-level element', async () => {
  const { anchor, calls, elements, stateManager } = await createAnchor();

  assert.ok(anchor);
  assert.equal(elements.length, 0, 'no element is built before playback');
  assert.equal(calls.some(call => call[0] === 'play'), false);

  await stateManager.setPlaying(true);

  assert.equal(elements.length, 1);
  const element = elements[0];
  assert.equal(element.loop, true);
  assert.equal(element.preload, 'auto');
  assert.equal(element.volume, 1);
  assert.equal(element.muted, false);
  assert.equal(element.disableRemotePlayback, true, 'the anchor never claims a remote playback route');
  assert.equal(element.src, 'blob:anchor-1');
  assert.equal(element.paused, false);
  assert.deepEqual(calls.filter(call => call[0] === 'createObjectURL'), [['createObjectURL', 'audio/wav']]);
});

test('anchor mirrors transport state and reuses one element across restarts', async () => {
  const { anchor, calls, elements, stateManager } = await createAnchor();

  await stateManager.setPlaying(true);
  await stateManager.setPlaying(false);
  assert.equal(elements[0].paused, true);

  await stateManager.setPlaying(true);
  assert.equal(elements.length, 1, 'the anchor element is reused');
  assert.equal(elements[0].paused, false);
  assert.deepEqual(
    calls.filter(call => call[0] === 'play' || call[0] === 'pause').map(call => call[0]),
    ['play', 'pause', 'play']
  );
  await anchor.dispose();
});

test('anchor starts immediately when playback is already running at construction', async () => {
  const { elements } = await createAnchor({ state: { isPlaying: true } });
  assert.equal(elements.length, 1);
  assert.equal(elements[0].paused, false);
});

test('a rejected start is retried on the next pointer gesture', async () => {
  const harness = createHarness({ playRejection: new Error('NotAllowedError') });
  const anchor = new MediaSessionAnchor({
    stateManager: harness.stateManager,
    audioCtor: harness.windowRef.Audio,
    blobCtor: harness.windowRef.Blob,
    urlRef: harness.windowRef.URL,
    documentRef: harness.documentRef,
    durationSeconds: 0.01
  });
  await flushMicrotasks();

  await harness.stateManager.setPlaying(true);
  assert.ok(harness.calls.some(call => call[0] === 'documentAddEventListener' && call[1] === 'pointerdown'));
  assert.equal(harness.calls.filter(call => call[0] === 'play').length, 1);
  assert.equal(anchor.gestureRetryArmed, true);

  harness.documentRef.dispatch('pointerdown');
  await flushMicrotasks();
  assert.equal(harness.calls.filter(call => call[0] === 'play').length, 2);

  await anchor.dispose();
});

test('anchor rebuilds its element after a transient decode failure', async () => {
  const { anchor, elements, revoked, stateManager, calls } = await createAnchor();

  await stateManager.setPlaying(true);
  assert.equal(anchor.failureCount, 0);

  elements[0].emitError();
  assert.equal(anchor.element, null, 'the failed element is released');
  assert.deepEqual(revoked, ['blob:anchor-1']);
  assert.equal(anchor.failureCount, 1);

  await stateManager.setPlaying(false);
  await stateManager.setPlaying(true);

  assert.equal(elements.length, 2, 'the next playback start rebuilds the element');
  assert.equal(anchor.element, elements[1]);
  assert.equal(elements[1].paused, false);
  assert.equal(calls.filter(call => call[0] === 'play').length, 2);
  assert.equal(anchor.failureCount, 0, 'a playable element clears the earlier failure');
});

test('anchor gives up after repeated element failures', async () => {
  // Failures only accumulate while play() keeps failing too: a resolved play()
  // proves the element is usable and clears the earlier count.
  const { anchor, elements, revoked, stateManager } = await createAnchor({
    playRejection: new Error('NotSupportedError')
  });
  const warnings = [];

  await withGlobals({
    console: createConsoleHarness({
      warn(...args) {
        warnings.push(args.join(' '));
      }
    })
  }, async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await stateManager.setPlaying(true);
      anchor.element?.emitError();
      await stateManager.setPlaying(false);
    }
  });

  assert.equal(elements.length, 3, 'rebuilds stop at MAX_ELEMENT_FAILURES');
  assert.equal(anchor.failureCount, 3);
  assert.equal(anchor.element, null);
  assert.deepEqual(revoked, ['blob:anchor-1', 'blob:anchor-1', 'blob:anchor-1']);
  assert.equal(warnings.length, 1, 'giving up is reported exactly once');
  assert.match(warnings[0], /^\[MediaSessionAnchor\]/);
});

test('anchor survives an object URL that cannot be created', async () => {
  const { anchor, stateManager, elements, revoked } = await createAnchor({
    createObjectUrlError: new Error('quota')
  });

  await stateManager.setPlaying(true);
  assert.equal(anchor.element, null);
  assert.equal(elements.length, 0);
  assert.deepEqual(revoked, [], 'no URL was handed out to revoke');
  assert.equal(anchor.failureCount, 1);
});

test('dispose releases the element, the object URL, and every listener', async () => {
  const { anchor, calls, elements, revoked, stateManager, documentRef } = await createAnchor();

  await stateManager.setPlaying(true);
  await anchor.dispose();

  assert.equal(anchor.element, null);
  assert.deepEqual(revoked, ['blob:anchor-1']);
  assert.equal(elements[0].listeners.size, 0);
  assert.equal(stateManager.listenerCount('isPlaying'), 0);
  assert.ok(calls.some(call => call[0] === 'removeAttribute' && call[1] === 'src'));
  assert.ok(calls.some(call => call[0] === 'load'));

  const playsBefore = calls.filter(call => call[0] === 'play').length;
  await stateManager.setPlaying(true);
  await anchor.sync();
  assert.equal(calls.filter(call => call[0] === 'play').length, playsBefore);
  await anchor.dispose();

  documentRef.dispatch('pointerdown');
});

test('dispose detaches an armed gesture retry', async () => {
  const harness = createHarness({ playRejection: new Error('NotAllowedError'), state: { isPlaying: true } });
  const anchor = new MediaSessionAnchor({
    stateManager: harness.stateManager,
    audioCtor: harness.windowRef.Audio,
    blobCtor: harness.windowRef.Blob,
    urlRef: harness.windowRef.URL,
    documentRef: harness.documentRef,
    durationSeconds: 0.01
  });
  await flushMicrotasks();
  assert.equal(anchor.gestureRetryArmed, true);

  await anchor.dispose();
  assert.ok(harness.calls.some(call => call[0] === 'documentRemoveEventListener' && call[1] === 'pointerdown'));
  assert.equal(anchor.gestureRetryArmed, false);
});

test('rapid transport toggles settle on the latest requested state', async () => {
  const { anchor, elements, stateManager } = await createAnchor();

  stateManager.state.isPlaying = true;
  const first = anchor.sync();
  stateManager.state.isPlaying = false;
  const second = anchor.sync();
  stateManager.state.isPlaying = true;
  const third = anchor.sync();
  assert.equal(first, second);
  assert.equal(second, third);

  await third;
  await flushMicrotasks();
  assert.equal(elements.length, 1);
  assert.equal(elements[0].paused, false);
});

test('anchor without a document reference skips gesture retries', async () => {
  const harness = createHarness({ playRejection: new Error('NotAllowedError'), state: { isPlaying: true } });
  const anchor = new MediaSessionAnchor({
    stateManager: harness.stateManager,
    audioCtor: harness.windowRef.Audio,
    blobCtor: harness.windowRef.Blob,
    urlRef: harness.windowRef.URL,
    durationSeconds: 0.01
  });
  await flushMicrotasks();

  assert.equal(anchor.gestureRetryArmed, false);
  await anchor.dispose();
});

test('pause and teardown failures leave the anchor disposable', async () => {
  const harness = createHarness({ state: { isPlaying: true } });
  const anchor = new MediaSessionAnchor({
    stateManager: harness.stateManager,
    audioCtor: harness.windowRef.Audio,
    blobCtor: harness.windowRef.Blob,
    urlRef: {
      createObjectURL: harness.windowRef.URL.createObjectURL,
      revokeObjectURL() {
        throw new Error('already revoked');
      }
    },
    documentRef: harness.documentRef,
    durationSeconds: 0.01
  });
  await flushMicrotasks();

  const element = harness.elements[0];
  element.pause = () => {
    throw new Error('pause failed');
  };
  await harness.stateManager.setPlaying(false);
  await anchor.dispose();
  assert.equal(anchor.element, null);
});
