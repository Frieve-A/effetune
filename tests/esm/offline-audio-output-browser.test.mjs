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

      const trimmedCases = await page.evaluate(async () => {
        const { AudioEncoder } = await import('/js/audio/audio-encoder.js');
        const results = [];
        for (const [format, quality, sampleRate] of [
          ['wav', 'pcm16', 48000], ['wav', 'pcm24', 48000], ['wav', 'float32', 48000],
          ['flac', 'pcm16', 48000], ['flac', 'pcm24', 48000], ['flac', 'pcm24', 96000]
        ]) {
          const input = new AudioBuffer({ numberOfChannels: 2, length: 32768, sampleRate: 48000 });
          input.getChannelData(0)[0] = .1;
          input.getChannelData(1)[8960] = -.00003;
          input.getChannelData(0)[12800] = -3e-10;
          input.getChannelData(0)[14080] = -2e-10;
          input.getChannelData(1)[15360] = 3e-8;
          for (let index = 25600; index < 32768; index++) input.getChannelData(0)[index] = index & 1 ? -1e-19 : 1e-19;
          const settings = { format, sampleRate, wavSampleFormat: quality, flacSampleFormat: quality };
          const encoder = new AudioEncoder();
          const whole = await encoder.encode(input, settings);
          const trimmed = await encoder.encode(input, settings, { trimTrailingZerosAfterSeconds: 1024 / 48000 });
          const decoder = new OfflineAudioContext(2, 1, sampleRate);
          const reference = await decoder.decodeAudioData(await whole.blob.arrayBuffer());
          const decoded = await decoder.decodeAudioData(await trimmed.blob.arrayBuffer());
          let last = -1, matchingPrefix = true;
          for (let channel = 0; channel < 2; channel++) {
            const expected = reference.getChannelData(channel), actual = decoded.getChannelData(channel);
            for (let index = 0; index < expected.length; index++) if (expected[index] !== 0 && index > last) last = index;
            for (let index = 0; index < actual.length; index++) if (actual[index] !== expected[index]) matchingPrefix = false;
          }
          results.push({ format, quality, sampleRate, fullLength: reference.length,
            actualLength: decoded.length, expectedLength: Math.max(Math.ceil(1024 / 48000 * sampleRate), last + 1),
            last, matchingPrefix });
        }
        return results;
      });
      for (const value of trimmedCases) {
        assert.equal(value.actualLength, value.expectedLength, JSON.stringify(value));
        assert.equal(value.matchingPrefix, true, JSON.stringify(value));
        if (value.quality === 'float32') assert.equal(value.actualLength, value.fullLength);
      }
      assert.equal(trimmedCases.find(value => value.format === 'wav' && value.quality === 'pcm24').last, 8960);
      assert.equal(trimmedCases.find(value => value.format === 'flac' && value.quality === 'pcm24').last, 12800,
        'the pinned FLAC float-to-int32 shift keeps negative values WAV PCM24 rounds to zero');

      const midiFlac = await page.evaluate(async () => {
        const [{ OfflineProcessor }, { AudioEncoder }, { parseSfz }, { packSfzAsset },
          { DSP_PARAM_PACKERS }, { instantiateDsp }] = await Promise.all([
          import('/js/audio/offline-processor.js'), import('/js/audio/audio-encoder.js'),
          import('/js/sfz/parser.js'), import('/js/sfz/asset.js'),
          import('/js/audio/dsp-params.generated.js'), import('/js/audio/dsp-wasm-loader.js')
        ]);
        const parsed = await parseSfz({ selectedPath: 'test.sfz', readText: async () =>
          '<region> sample=constant.wav key=69 amp_veltrack=0 loop_mode=loop_continuous ampeg_release=.02',
        hasSample: () => true, onDiagnostic: null });
        const asset = packSfzAsset(parsed.regions, new Map([['constant.wav', {
          channels: [Float32Array.from({ length: 256 }, () => .25)], sampleRate: 48000
        }]]));
        class SoundFontPlayerPlugin {
          constructor() { this.id = 1; this.enabled = true; this.sf = 'fixture'; }
          getParameters() { return { enabled: true, channel: 'A', inputBus: 0, outputBus: 0, mc: 0, pl: 64, og: 0 }; }
          getWasmAssets() { return new Map([[0, asset]]); }
          get offlineDspAssetRequired() { return true; }
          async createOfflineDspState() { return { parameters: this.getParameters(), assets: this.getWasmAssets(),
            offlineDspAssetRequired: true }; }
        }
        const [bytes, meta] = await Promise.all([
          fetch('/plugins/dsp/effetune-dsp.simd.wasm').then(response => response.arrayBuffer()),
          fetch('/plugins/dsp/effetune-dsp.meta.json').then(response => response.json())
        ]);
        const processor = new OfflineProcessor({ audioContext: { sampleRate: 48000,
          decodeAudioData() { throw new Error('MIDI entered the audio decoder'); } },
        createOfflineContext: (channels, length, rate) => new OfflineAudioContext(channels, length, rate) },
        new AudioEncoder(), { getModuleInfo: async () => ({ bytes, meta, paramPackers: DSP_PARAM_PACKERS }),
          instantiateDsp });
        const track = [1, 0x90, 69, 127, 0x82, 0x2b, 0x80, 69, 0, 0, 255, 47, 0];
        const smf = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 3, 232,
          77, 84, 114, 107, 0, 0, 0, track.length, ...track]);
        const output = await processor.processAudioFile(new File([smf], 'test.mid'), [new SoundFontPlayerPlugin()], null,
          { format: 'flac', sampleRate: 48000, flacSampleFormat: 'pcm24' });
        const audio = new AudioContext({ sampleRate: 48000 });
        try {
          const decoded = await audio.decodeAudioData(await output.blob.arrayBuffer());
          return { format: output.format, size: output.blob.size, tailLimitReached: output.tailLimitReached,
            duration: decoded.duration, peak: decoded.getChannelData(0).reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) };
        } finally { await audio.close(); }
      });
      assert.equal(midiFlac.format, 'flac');
      assert.equal(midiFlac.tailLimitReached, false);
      assert.ok(midiFlac.size > 42);
      assert.ok(midiFlac.duration > .15, 'FLAC must retain the synthesized release');
      assert.ok(midiFlac.peak > .01, 'decoded FLAC must contain the generated SFZ waveform');

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
