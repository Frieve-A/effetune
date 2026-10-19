import assert from 'node:assert/strict';
import test from 'node:test';

import { SynchronizedVideo } from '../../js/ui/audio-player/synchronized-video.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class FakeVideo extends EventTarget {
  constructor() {
    super();
    this.src = '';
    this.videoWidth = 0;
    this.currentTime = 0;
    this.duration = 60;
    this.playbackRate = 1;
    this.paused = true;
    this.seeking = false;
    this.ended = false;
    this.readyState = 0;
    this.asyncSeeking = false;
    this.seekCalls = 0;
    this.playCalls = 0;
    this.loadCalls = 0;
  }

  play() {
    this.playCalls += 1;
    if (this.ended) this.currentTime = 0;
    this.paused = false;
    return Promise.resolve();
  }

  pause() { this.paused = true; }
  get currentTime() { return this.time; }
  set currentTime(value) {
    this.time = value;
    this.ended = false;
    if (this.asyncSeeking) {
      this.seekCalls += 1;
      this.seeking = true;
      this.readyState = 1;
    }
  }
  seeked() {
    this.seeking = false;
    this.readyState = 2;
    this.dispatchEvent(new Event('seeked'));
  }
  hasAttribute(name) { return name === 'src' && this.src !== ''; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() { this.loadCalls += 1; }
  loaded(width = 640) {
    this.videoWidth = width;
    this.readyState = 2;
    this.dispatchEvent(new Event('loadeddata'));
  }
}

async function withVideoEnvironment(callback) {
  const elements = [];
  const createdUrls = [];
  const revokedUrls = [];
  await withGlobals({
    document: {
      createElement(tag) {
        assert.equal(tag, 'video');
        const video = new FakeVideo();
        elements.push(video);
        return video;
      }
    },
    URL: {
      createObjectURL(blob) {
        const url = `blob:display-${createdUrls.length + 1}`;
        createdUrls.push({ blob, url });
        return url;
      },
      revokeObjectURL(url) { revokedUrls.push(url); }
    }
  }, async () => {
    const display = new SynchronizedVideo();
    display.setEnabled(true);
    display.setActive(true);
    try {
      await callback({ display, elements, createdUrls, revokedUrls });
    } finally {
      display.setEnabled(false);
    }
  });
}

test('synchronized video seeks large drift and corrects small drift at the requested playback speed', async () => {
  await withVideoEnvironment(({ display }) => {
    display.load('file:///movie.mp4');
    const video = display.element;
    video.loaded();
    video.currentTime = 3;
    assert.equal(display.frame(5, 1, true), video);
    assert.equal(video.currentTime, 5);
    assert.equal(video.paused, false);
    assert.equal(video.playbackRate, 1.05);

    video.currentTime = 5.1;
    display.frame(5, 2, true);
    assert.equal(video.currentTime, 5.1);
    assert.ok(Math.abs(video.playbackRate - 1.9) < 1e-12);
    assert.equal(video.playCalls, 1);

    video.currentTime = 4.9;
    display.frame(5, 0.5, true);
    assert.ok(Math.abs(video.playbackRate - 0.525) < 1e-12);
    video.currentTime = 5;
    display.frame(5, 2, true);
    assert.equal(video.playbackRate, 2);
  });
});

test('a slow seek resumes playback and catches the moving target without serial seeks', async () => {
  await withVideoEnvironment(({ display }) => {
    display.load('file:///movie.mp4');
    const video = display.element;
    video.loaded();
    video.asyncSeeking = true;
    let seekUntil = 0;
    for (let tick = 0; tick <= 1000; tick++) {
      if (video.seeking && tick >= seekUntil) video.seeked();
      if (!video.paused && !video.seeking) video.time += video.playbackRate / 100;
      const previousSeeks = video.seekCalls;
      display.frame(5 + tick / 100, 1, true);
      if (video.seekCalls !== previousSeeks) seekUntil = tick + 35;
      assert.ok(video.playbackRate >= 1 && video.playbackRate <= 1.05);
    }
    assert.equal(video.seekCalls, 1);
    assert.equal(video.playCalls, 1);
    assert.equal(video.seeking, false);
    assert.ok(Math.abs(video.currentTime - 15) < 0.02);
  });
});

test('seek recovery shrinks with progress and still resynchronizes new decoder stalls', async () => {
  await withVideoEnvironment(({ display }) => {
    display.load('file:///movie.mp4');
    const video = display.element;
    video.loaded();
    video.asyncSeeking = true;
    display.frame(5, 1, true);
    video.seeked();
    display.frame(5.4, 1, true);
    assert.equal(video.seekCalls, 1);
    video.time = 5.8;
    display.frame(6, 1, true);
    // Half the original seek lag was recovered; a fresh 300 ms stall must trigger a seek.
    display.frame(6.3, 1, true);
    assert.equal(video.seekCalls, 2);
    video.seeked();
    display.frame(6.7, 1, true);
    assert.equal(video.seekCalls, 2);
    // Recovery for the second seek must not accumulate the first seek's allowance.
    display.frame(7, 1, true);
    assert.equal(video.seekCalls, 3);
  });
});

test('explicit resets and pausing discard slow-seek recovery', async () => {
  for (const resetWhileSeeking of [false, true]) {
    await withVideoEnvironment(({ display }) => {
      const snapshot = { source: 'file:///movie.mp4', generation: 1, resetToken: 0, contextTime: 0 };
      display.setPresentation(snapshot);
      const video = display.element;
      video.loaded();
      video.asyncSeeking = true;
      display.frame(5, 1, true);
      if (!resetWhileSeeking) {
        video.seeked();
        display.frame(5.4, 1, true);
      }
      display.setPresentation({ ...snapshot, resetToken: 1 });
      if (resetWhileSeeking) video.seeked();
      display.frame(5.6, 1, true);
      assert.equal(video.seekCalls, 2);
      assert.equal(video.currentTime, 5.6);
      video.seeked();
      display.frame(6, 1, true);
      display.frame(6, 1, false);
      assert.equal(video.paused, true);
      assert.equal(video.currentTime, 6);
      video.seeked();
      display.frame(6.4, 1, true);
      assert.equal(video.currentTime, 6.4);
      assert.equal(video.seeking, true);
    });
  }
});

test('synchronized video follows paused seeks and holds the end without restarting playback', async () => {
  await withVideoEnvironment(({ display }) => {
    display.load('file:///movie.mp4');
    const video = display.element;
    video.loaded();
    display.frame(5, 1, true);
    display.frame(12, 1, false);
    assert.equal(video.currentTime, 12);
    assert.equal(video.paused, true);

    video.currentTime = 12.01;
    display.frame(12, 1, false);
    assert.equal(video.currentTime, 12.01);
    video.seeking = true;
    display.frame(20, 1, false);
    assert.equal(video.currentTime, 12.01);
    video.seeking = false;
    display.frame(20, 1, false);
    assert.equal(video.currentTime, 20);

    display.frame(59, 1, true);
    const playCalls = video.playCalls;
    display.frame(60, 1, true);
    assert.equal(video.currentTime, 60);
    assert.equal(video.paused, true);
    assert.equal(video.playCalls, playCalls);
  });
});

test('synchronized video waits for a picture and releases only its own Blob URLs across tracks and disable', async () => {
  await withVideoEnvironment(({ display, elements, createdUrls, revokedUrls }) => {
    const first = new Blob(['first'], { type: 'video/mp4' });
    const second = new Blob(['second'], { type: 'video/mp4' });
    display.load(first);
    const video = display.element;
    assert.equal(video.muted, true);
    assert.equal(video.playsInline, true);
    assert.equal(video.preload, 'auto');
    assert.equal(display.frame(0, 1, true), null);
    video.loaded(0);
    assert.equal(display.frame(0, 1, true), null);
    assert.equal(video.playCalls, 0);
    video.loaded();
    assert.equal(display.frame(0, 1, true), video);
    display.setActive(false);
    assert.equal(video.paused, true);
    assert.equal(display.frame(1, 1, true), null);
    assert.deepEqual(revokedUrls, []);
    display.setActive(true);

    display.load(first);
    assert.equal(createdUrls.length, 1);
    assert.equal(display.frame(1, 1, false), video);
    display.load(second);
    const secondVideo = display.element;
    assert.deepEqual(revokedUrls, ['blob:display-1']);
    assert.equal(createdUrls[1].blob, second);
    assert.equal(display.frame(1, 1, false), null);
    secondVideo.loaded();
    assert.equal(display.frame(1, 1, false), secondVideo);

    display.load('blob:audio-master');
    const masterVideo = display.element;
    assert.deepEqual(revokedUrls, ['blob:display-1', 'blob:display-2']);
    assert.equal(masterVideo.src, 'blob:audio-master');
    assert.equal(display.frame(1, 1, true), null);
    masterVideo.loaded();
    display.frame(1, 1, true);
    display.setEnabled(false);
    assert.equal(masterVideo.paused, true);
    assert.equal(masterVideo.src, '');
    assert.equal(masterVideo.loadCalls, 1);
    assert.equal(display.frame(1, 1, true), null);
    assert.deepEqual(revokedUrls, ['blob:display-1', 'blob:display-2']);
    assert.deepEqual(elements, [video, secondVideo, masterVideo]);
  });
});

test('synchronized video holds the first frame throughout signed prestart time', async () => {
  await withVideoEnvironment(({ display }) => {
    display.load('file:///movie.mp4');
    const video = display.element;
    video.loaded();
    for (const target of [-0.4, -0.1, -0.001]) {
      assert.equal(display.frame(target, 2, true), video);
      assert.equal(video.currentTime, 0);
      assert.equal(video.paused, true);
    }
    assert.equal(video.playCalls, 0);
    display.frame(0, 2, true);
    assert.equal(video.playbackRate, 2);
    assert.equal(video.playCalls, 1);
  });
});

test('natural end plays the retained tail on the audio clock despite source reset', async () => {
  await withVideoEnvironment(({ display }) => {
    const source = new Blob(['movie']);
    const snapshot = { generation: 1, source, resetToken: 0, contextTime: 10, naturalEnd: null };
    display.setPresentation(snapshot);
    const video = display.element;
    video.duration = 10;
    video.loaded();
    video.currentTime = 9.8;
    display.frame(9.8, 1, true);
    const naturalEnd = { generation: 1, source, endPosition: 10, playbackSpeed: 1,
      targetAtEnd: 9.8, contextTimeAtEnd: 10 };
    display.setPresentation({ ...snapshot, naturalEnd, contextTime: 10.1 });
    assert.equal(display.frame(-0.2, 2, false), video);
    assert.equal(video.paused, false);
    assert.ok(video.playbackRate >= 1 && video.playbackRate <= 1.05);
    assert.equal(display.needsFrame, true);
    display.setPresentation({ ...snapshot, naturalEnd: null, contextTime: 10.2 });
    display.frame(-0.2, 2, false);
    assert.equal(video.currentTime, 10);
    assert.equal(video.paused, true);
    assert.equal(display.needsFrame, false);
  });
});

test('natural handoff waits for the old tail, incoming audible time and decoded first frame', async () => {
  await withVideoEnvironment(({ display, elements, revokedUrls }) => {
    const source = new Blob(['first']);
    const next = new Blob(['next']);
    const first = { generation: 1, source, resetToken: 0, contextTime: 10, naturalEnd: null };
    display.setPresentation(first);
    const old = display.element;
    old.duration = 10;
    old.loaded();
    old.currentTime = 9.8;
    const naturalEnd = { generation: 1, source, endPosition: 10, playbackSpeed: 1,
      targetAtEnd: 9.8, contextTimeAtEnd: 10 };
    const incoming = { ...first, generation: 2, source: next, naturalEnd };
    display.setPresentation(incoming);
    assert.equal(elements.length, 2);
    const pending = elements[1];
    assert.equal(pending.currentTime, 0);
    assert.equal(pending.paused, true);
    display.setPresentation({ ...incoming, contextTime: 10.3 });
    assert.equal(display.frame(0.1, 1, true), old);
    assert.equal(old.currentTime, 10);
    pending.loaded();
    assert.equal(display.frame(-0.01, 1, true), old);
    assert.equal(display.frame(0, 1, true), pending);
    assert.equal(display.element, pending);
    assert.equal(old.src, '');
    assert.deepEqual(revokedUrls, ['blob:display-1']);
    assert.equal(display.needsFrame, false);
  });
});

test('an early-ended decoder seeks explicitly before resuming instead of replaying frame zero', async () => {
  await withVideoEnvironment(({ display }) => {
    const source = new Blob(['movie']);
    const snapshot = { generation: 1, source, resetToken: 0, contextTime: 0, naturalEnd: null };
    display.setPresentation(snapshot);
    const video = display.element;
    video.duration = 1.6;
    video.loaded();
    video.currentTime = video.duration;
    video.ended = true;
    video.asyncSeeking = true;
    const naturalEnd = { generation: 1, source, endPosition: 1.6, playbackSpeed: 1,
      targetAtEnd: 1.55, contextTimeAtEnd: 0 };
    display.setPresentation({ ...snapshot, naturalEnd });
    display.frame(-0.2, 1, false);
    assert.equal(video.currentTime, 1.55);
    assert.equal(video.seeking, true);
    assert.equal(video.playCalls, 0);
    display.frame(-0.2, 1, false);
    assert.equal(video.playCalls, 0);
    video.seeked();
    display.frame(-0.2, 1, false);
    assert.equal(video.playCalls, 1);
    assert.equal(video.currentTime, 1.55);

    // An explicit replay still seeks to the beginning and starts after that seek completes.
    video.currentTime = video.duration;
    video.seeked();
    video.ended = true;
    video.pause();
    display.setPresentation({ ...snapshot, resetToken: 1 });
    display.frame(0, 1, true);
    assert.equal(video.currentTime, 0);
    assert.equal(video.playCalls, 1);
    video.seeked();
    display.frame(0, 1, true);
    assert.equal(video.playCalls, 2);
  });
});

test('incoming presentation waits for its requested decoded frame even within normal drift tolerance', async () => {
  for (const target of [0.24, 0.4]) {
    await withVideoEnvironment(({ display }) => {
      const source = new Blob(['first']);
      const first = { generation: 1, source, resetToken: 0, contextTime: 0, naturalEnd: null };
      display.setPresentation(first);
      const old = display.element;
      old.loaded();
      const naturalEnd = { generation: 1, source, endPosition: 60, playbackSpeed: 1,
        targetAtEnd: 60, contextTimeAtEnd: 0 };
      display.setPresentation({ ...first, generation: 2, source: new Blob(['next']), naturalEnd });
      const pending = display.pending.element;
      pending.loaded();
      pending.asyncSeeking = true;
      assert.equal(display.frame(target, 1, true), old);
      assert.equal(pending.currentTime, target);
      assert.equal(pending.seeking, true);
      assert.notEqual(old.src, '');
      assert.equal(display.frame(target + 0.01, 1, true), old);
      assert.equal(pending.currentTime, target);
      pending.seeked();
      assert.equal(display.frame(target + 0.02, 1, true), pending);
      assert.equal(old.src, '');
      assert.equal(pending.playCalls, 1);
    });
  }
});

test('a slow incoming seek promotes its decoded frame and catches the moving target', async () => {
  await withVideoEnvironment(({ display, revokedUrls }) => {
    const source = new Blob(['first']);
    const first = { generation: 1, source, resetToken: 0, contextTime: 0, naturalEnd: null };
    display.setPresentation(first);
    const old = display.element;
    old.loaded();
    const naturalEnd = { generation: 1, source, endPosition: 60, playbackSpeed: 1,
      targetAtEnd: 60, contextTimeAtEnd: 0 };
    display.setPresentation({ ...first, generation: 2, source: new Blob(['next']), naturalEnd });
    const pending = display.pending.element;
    pending.loaded();
    pending.asyncSeeking = true;
    let seekUntil = 0;
    for (let tick = 0; tick <= 1000; tick++) {
      if (pending.seeking && tick >= seekUntil) pending.seeked();
      if (!pending.paused && !pending.seeking) pending.time += pending.playbackRate / 100;
      const previousSeeks = pending.seekCalls;
      const frame = display.frame(0.24 + tick / 100, 1, true);
      if (pending.seekCalls !== previousSeeks) seekUntil = tick + 35;
      assert.equal(frame, tick < 35 ? old : pending);
      if (tick < 35) assert.notEqual(old.src, '');
    }
    assert.equal(pending.seekCalls, 1);
    assert.equal(pending.playCalls, 1);
    assert.ok(Math.abs(pending.currentTime - 10.24) < 0.02);
    assert.equal(display.pending, null);
    assert.equal(old.src, '');
    assert.deepEqual(revokedUrls, ['blob:display-1']);
  });
});

test('canceling a pending alignment removes its completion listener', async () => {
  await withVideoEnvironment(({ display }) => {
    const source = new Blob(['first']);
    const first = { generation: 1, source, resetToken: 0, contextTime: 0, naturalEnd: null };
    display.setPresentation(first);
    const old = display.element;
    old.loaded();
    const naturalEnd = { generation: 1, source, endPosition: 60, playbackSpeed: 1,
      targetAtEnd: 60, contextTimeAtEnd: 0 };
    display.setPresentation({ ...first, generation: 2, source: new Blob(['next']), naturalEnd });
    const pendingEntry = display.pending;
    const pending = pendingEntry.element;
    pending.loaded();
    pending.asyncSeeking = true;
    assert.equal(display.frame(0.24, 1, true), old);
    assert.equal(display.frame(0.6, 1, true), old);
    assert.equal(pending.currentTime, 0.24);
    assert.equal(pending.seeking, true);
    assert.equal(pendingEntry.aligned, false);
    display.setPresentation({ ...first, resetToken: 1 });
    pending.seeked();
    assert.equal(pendingEntry.aligned, false);
    assert.equal(display.pending, null);
    assert.equal(display.element, old);
    assert.equal(pending.src, '');
  });
});

test('same-source repeat prepares a separate beginning and manual intent cancels the pending tail', async () => {
  await withVideoEnvironment(({ display, elements, revokedUrls }) => {
    const source = new Blob(['movie']);
    const first = { generation: 1, source, resetToken: 0, contextTime: 10, naturalEnd: null };
    display.setPresentation(first);
    const old = display.element;
    old.duration = 10;
    old.loaded();
    const naturalEnd = { generation: 1, source, endPosition: 10, playbackSpeed: 1,
      targetAtEnd: 9.8, contextTimeAtEnd: 10 };
    display.setPresentation({ ...first, generation: 2, naturalEnd });
    assert.equal(elements.length, 2);
    const pending = elements[1];
    pending.loaded();
    display.setPresentation({ ...first, generation: 2, resetToken: 1, contextTime: 10.1 });
    assert.equal(pending.src, '');
    assert.deepEqual(revokedUrls, ['blob:display-2']);
    assert.equal(display.needsFrame, false);
    assert.equal(display.frame(3, 1, false), old);
    assert.equal(old.currentTime, 3);
    assert.equal(old.paused, true);
  });
});
