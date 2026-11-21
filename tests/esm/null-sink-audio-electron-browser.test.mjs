import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const tapSource = `
  registerProcessor('feed-tap', class extends AudioWorkletProcessor {
    frames = 0;
    blocks = 0;
    process(_inputs, outputs) {
      this.frames += outputs[0][0].length;
      if (++this.blocks % 16 === 0) this.port.postMessage(this.frames);
      return true;
    }
  });
`;

async function checkClock(feed, label) {
  const snapshot = () => feed.evaluate(({ context, tapState }) => ({
    wallTime: performance.now() / 1000, audioTime: context.currentTime,
    tapTime: tapState.frames / context.sampleRate, state: context.state
  }));
  const before = await snapshot();
  await delay(1200);
  const after = await snapshot();
  const elapsed = after.wallTime - before.wallTime;
  assert.equal(after.state, 'running', label);
  for (const clock of ['audioTime', 'tapTime']) {
    const advanced = after[clock] - before[clock];
    assert.ok(Math.abs(advanced - elapsed) < elapsed * 0.25,
      `${label}: ${clock} advanced ${advanced}s in ${elapsed}s`);
  }
}

test('a null audio sink clocks a feed worklet in real time while the window is shown and hidden', {
  timeout: 60_000
}, async () => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-null-sink-')));
  let application;
  try {
    await writeFile(path.join(profile, 'feed.html'), '<!doctype html><title>Feed clock test</title>');
    await writeFile(path.join(profile, 'feed-tap.js'), tapSource);
    application = await electron.launch({
      args: [fileURLToPath(new URL('../helpers/null-sink-electron-main.cjs', import.meta.url)),
        `--user-data-dir=${profile}`],
      timeout: 20_000
    });
    const page = await application.firstWindow();
    await page.waitForURL('**/feed.html');
    const window = await application.browserWindow(page);
    for (const sampleRate of [44100, 96000, 384000]) {
      assert.ok(await window.evaluate(win => { win.showInactive(); return win.isVisible(); }));
      const feed = await page.evaluateHandle(async rate => {
        const context = new AudioContext({ sampleRate: rate, sinkId: { type: 'none' } });
        await context.audioWorklet.addModule('./feed-tap.js');
        const source = context.createConstantSource();
        const tap = new AudioWorkletNode(context, 'feed-tap');
        const tapState = { frames: 0 };
        tap.port.onmessage = ({ data }) => { tapState.frames = data; };
        source.connect(tap).connect(context.destination);
        source.start();
        await context.resume();
        return { context, tapState };
      }, sampleRate);
      try {
        assert.deepEqual(await feed.evaluate(({ context }) => [context.sampleRate, context.sinkId.type]),
          [sampleRate, 'none']);
        await page.waitForFunction(({ tapState }) => tapState.frames > 0, feed,
          { timeout: 5000, polling: 50 });
        await checkClock(feed, `${sampleRate} Hz, shown`);
        assert.equal(await window.evaluate(win => { win.hide(); return win.isVisible(); }), false);
        await checkClock(feed, `${sampleRate} Hz, hidden`);
      } finally {
        await feed.evaluate(({ context }) => context.close());
        await feed.dispose();
      }
    }
  } finally {
    try {
      await application?.close();
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});
