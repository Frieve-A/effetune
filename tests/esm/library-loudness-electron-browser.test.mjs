import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron as electron } from 'playwright';

test('Electron decodes generated FLAC in the analysis worker at its original loudness', { timeout: 60000 }, async () => {
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-loudness-')));
  let app;
  try {
    app = await electron.launch({
      args: [fileURLToPath(new URL('../helpers/startup-app-electron-main.cjs', import.meta.url))],
      env: { ...process.env, EFFETUNE_STARTUP_TEST_PROFILE: profile, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    });
    const page = app.windows().find(w => w.url().includes('/effetune.html')) ??
      await app.waitForEvent('window', { predicate: async w => {
        await w.waitForURL('**/effetune.html*', { timeout: 20000 }).catch(() => {});
        return w.url().includes('/effetune.html');
      }, timeout: 30000 });
    const result = await page.evaluate(async () => {
      const { AudioSample, AudioSampleSource, BufferTarget, FlacOutputFormat, Output } =
        await import('./js/vendor/offline-audio-encoders.mjs');
      const { loadDspModule } = await import('./js/audio/dsp-wasm-loader.js');
      const target = new BufferTarget();
      const output = new Output({ target, format: new FlacOutputFormat() });
      const source = new AudioSampleSource({ codec: 'flac' });
      output.addAudioTrack(source);
      await output.start();
      const rate = 48000;
      const pcm = Int16Array.from({ length: rate }, (_, i) =>
        Math.round(32767 * 10 ** (-23 / 20) * Math.sin(2 * Math.PI * 1000 * i / rate)));
      const sample = new AudioSample({ data: pcm, format: 's16', numberOfChannels: 1, sampleRate: rate, timestamp: 0 });
      try { await source.add(sample); } finally { sample.close(); }
      await output.finalize();
      const dsp = await loadDspModule();
      const worker = new Worker('./js/vendor/loudness-analysis-worker.mjs', { type: 'module' });
      try {
        return await new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) => resolve(data);
          worker.onerror = event => reject(new Error(event.message));
          worker.postMessage({ file: new Blob([target.buffer], { type: 'audio/flac' }),
            module: dsp.moduleCloneable ? dsp.module : dsp.bytes });
        });
      } finally { worker.terminate(); }
    });
    assert.equal(result.status, 'measured');
    assert.ok(Math.abs(result.integrated + 23) < 0.1, String(result.integrated));
  } finally {
    await app?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
