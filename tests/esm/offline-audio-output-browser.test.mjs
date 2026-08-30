import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const root = path.resolve('.');
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8']
]);

async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const filePath = path.resolve(root, `.${pathname}`);
      if (!filePath.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': contentTypes.get(path.extname(filePath)) || 'application/octet-stream'
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

test('FLAC and WAV output encode and decode in Chromium while local codec assets remain reusable',
  { timeout: 120_000 }, async () => {
    const fixtureServer = await startFixtureServer();
    let browser = null;
    let context = null;
    let page = null;
    const errors = [];
    const externalRequests = [];
    try {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext();
      page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => {
        if (!request.url().startsWith(fixtureServer.baseURL) && !request.url().startsWith('blob:')) {
          externalRequests.push(request.url());
        }
      });
      await page.goto(`${fixtureServer.baseURL}/tests/browser/offline-audio-output.fixture.html`, {
        waitUntil: 'load'
      });
      await page.waitForFunction(() => Boolean(window.__offlineAudioOutputSmoke));

      for (const expected of [
        { numberOfChannels: 1, sampleRate: 44100, flacSampleFormat: 'pcm16', bitsPerSample: 16 },
        {
          numberOfChannels: 8,
          sourceSampleRate: 48000,
          sampleRate: 96000,
          flacSampleFormat: 'pcm24',
          bitsPerSample: 24
        },
        { numberOfChannels: 2, sampleRate: 192000, flacSampleFormat: 'pcm24', bitsPerSample: 24 }
      ]) {
        const result = await page.evaluate(expectedValue =>
          window.__offlineAudioOutputSmoke.encodeAndDecode(expectedValue), expected);
        assert.deepEqual(result.output, {
          format: 'flac',
          extension: 'flac',
          mimeType: 'audio/flac',
          sampleRate: expected.sampleRate,
          numberOfChannels: expected.numberOfChannels,
          size: result.output.size
        });
        assert.ok(result.output.size > 42);
        assert.deepEqual(result.streamInfo, {
          magic: 'fLaC',
          sampleRate: expected.sampleRate,
          numberOfChannels: expected.numberOfChannels,
          bitsPerSample: expected.bitsPerSample,
          totalSamples: result.streamInfo.totalSamples
        });
        assert.ok(result.streamInfo.totalSamples > 0);
        assert.equal(result.streamInfo.totalSamples, Math.round(expected.sampleRate * 0.5));
        assert.equal(result.decoded.numberOfChannels, expected.numberOfChannels);
        assert.ok(result.decoded.length > 0);
        assert.ok(Math.abs(
          result.decoded.length / result.decoded.sampleRate -
          result.streamInfo.totalSamples / result.streamInfo.sampleRate
        ) < 0.02);
      }

      const unsupportedChannels = await page.evaluate(() =>
        window.__offlineAudioOutputSmoke.rejectUnsupportedChannels());
      assert.deepEqual(unsupportedChannels, {
        key: 'error.offlineOutput.unsupportedChannels',
        values: { format: 'FLAC', maxChannels: 8 }
      });

      const wav = await page.evaluate(() => window.__offlineAudioOutputSmoke.encodeAndDecode({
        format: 'wav',
        wavSampleFormat: 'pcm24',
        numberOfChannels: 2,
        sampleRate: 96000
      }));
      assert.deepEqual(wav.output, {
        format: 'wav',
        extension: 'wav',
        mimeType: 'audio/wav',
        sampleRate: 96000,
        numberOfChannels: 2,
        size: wav.output.size
      });
      assert.ok(wav.output.size > 44);
      assert.deepEqual(wav.wavHeader, {
        riff: 'RIFF',
        wave: 'WAVE',
        formatCode: 1,
        numberOfChannels: 2,
        sampleRate: 96000,
        bitsPerSample: 24
      });
      assert.equal(wav.decoded.numberOfChannels, 2);
      assert.ok(wav.decoded.sampleRate > 0);
      assert.ok(Math.abs(wav.decoded.duration - 0.5) < 0.02);

      await context.setOffline(true);
      const lifecycle = await page.evaluate(() => window.__offlineAudioOutputSmoke.cancelAndReuse());
      assert.equal(lifecycle.canceledKey, 'status.processingCanceled');
      assert.equal(lifecycle.reused.output.format, 'flac');
      assert.equal(lifecycle.reused.streamInfo.magic, 'fLaC');
      assert.equal(lifecycle.reused.decoded.numberOfChannels, 2);
      assert.deepEqual(externalRequests, []);
      assert.deepEqual(errors, []);
    } finally {
      await page?.close();
      await context?.close();
      await browser?.close();
      await fixtureServer.close();
    }
  });
