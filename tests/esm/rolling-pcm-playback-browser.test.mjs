import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { chromium, webkit } from 'playwright';

const repoRoot = path.resolve('.');
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm']
]);
const captureWorkletSource = `
class RollingPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = true;
    this.port.onmessage = event => {
      if (event.data?.type === 'set-enabled') this.enabled = event.data.enabled === true;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    for (let channel = 0; channel < output.length; channel++) {
      if (input[channel]) output[channel].set(input[channel]);
      else output[channel].fill(0);
    }
    if (this.enabled && input.length > 0) {
      const planes = input.map(plane => plane.slice());
      this.port.postMessage({ frame: currentFrame, planes }, planes.map(plane => plane.buffer));
    }
    return true;
  }
}
registerProcessor('rolling-pcm-capture', RollingPcmCaptureProcessor);
`;

async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/tests/rolling-pcm-capture-worklet.js') {
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/javascript; charset=utf-8'
        });
        response.end(captureWorkletSource);
        return;
      }
      if (pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Rolling PCM fixture</title>');
        return;
      }
      const filePath = path.resolve(repoRoot, `.${pathname}`);
      if (!filePath.startsWith(`${repoRoot}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
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
  return {
    baseURL: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close(error => error ? reject(error) : resolve());
    })
  };
}

test('capture AudioWorklet preserves every frame of an independent sequential source',
  { timeout: 60_000 }, async () => {
    const fixtureServer = await startFixtureServer();
    let browser = null;
    let page = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--autoplay-policy=no-user-gesture-required']
      });
      page = await browser.newPage();
      await page.goto(fixtureServer.baseURL);
      const result = await page.evaluate(async () => {
        const sampleRate = 48000;
        const frameCount = 4096;
        const context = new AudioContext({ sampleRate });
        await context.audioWorklet.addModule('/tests/rolling-pcm-capture-worklet.js');
        const capture = new AudioWorkletNode(context, 'rolling-pcm-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit'
        });
        const blocks = [];
        capture.port.onmessage = event => blocks.push(event.data);
        capture.connect(context.destination);
        const buffer = context.createBuffer(2, frameCount, sampleRate);
        for (let channel = 0; channel < 2; channel++) {
          const plane = buffer.getChannelData(channel);
          for (let frame = 0; frame < frameCount; frame++) {
            plane[frame] = ((frame * 17 + channel * 101) % 997) / 1100 - 0.45;
          }
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(capture);
        await context.resume();
        const startFrame = Math.ceil((context.currentTime + 0.1) * sampleRate);
        const ended = new Promise(resolve => { source.onended = resolve; });
        source.start(startFrame / sampleRate);
        let timeoutId;
        try {
          await Promise.race([
            ended,
            new Promise((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error('capture timeout')), 5000);
            })
          ]);
        } finally {
          clearTimeout(timeoutId);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        const actual = Array.from({ length: 2 }, () => new Float32Array(frameCount));
        const seen = new Uint8Array(frameCount);
        const orderedFrames = [];
        for (const block of blocks) {
          orderedFrames.push(block.frame);
          const blockEnd = block.frame + (block.planes[0]?.length ?? 0);
          const from = Math.max(startFrame, block.frame);
          const to = Math.min(startFrame + frameCount, blockEnd);
          for (let absolute = from; absolute < to; absolute++) {
            const target = absolute - startFrame;
            const sourceOffset = absolute - block.frame;
            seen[target] = 1;
            for (let channel = 0; channel < 2; channel++) {
              actual[channel][target] = block.planes[channel][sourceOffset];
            }
          }
        }
        let maxError = 0;
        for (let channel = 0; channel < 2; channel++) {
          const expected = buffer.getChannelData(channel);
          for (let frame = 0; frame < frameCount; frame++) {
            const error = Math.abs(expected[frame] - actual[channel][frame]);
            if (error > maxError) maxError = error;
          }
        }
        const relevantFrames = orderedFrames.filter(frame =>
          frame + 128 > startFrame && frame < startFrame + frameCount);
        const sequenceGaps = relevantFrames.slice(1).filter((frame, index) =>
          frame !== relevantFrames[index] + 128).length;
        capture.port.postMessage({ type: 'set-enabled', enabled: false });
        capture.disconnect();
        await context.close();
        return {
          missingFrames: seen.reduce((count, value) => count + (value === 0 ? 1 : 0), 0),
          sequenceGaps,
          maxError
        };
      });
      assert.deepEqual(result, { missingFrames: 0, sequenceGaps: 0, maxError: 0 });
    } finally {
      await page?.close();
      await browser?.close();
      await fixtureServer.close();
    }
  });

test('production Worker transport preserves PCM across a scheduled current-to-next boundary',
  { timeout: 90_000 }, async () => {
    const fixtureServer = await startFixtureServer();
    let browser = null;
    let page = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--autoplay-policy=no-user-gesture-required']
      });
      page = await browser.newPage();
      await page.goto(fixtureServer.baseURL);
      const result = await page.evaluate(async () => {
        const [{ AudioEncoder }, { RollingPcmTransport }] = await Promise.all([
          import('/js/audio/audio-encoder.js'),
          import('/js/ui/audio-player/rolling-pcm-transport.js')
        ]);
        const sampleRate = 48000;
        const slabFrames = 96000;
        const currentFrames = slabFrames * 2;
        const nextFrames = slabFrames;
        const totalFrames = currentFrames + nextFrames;
        const markerInterval = 4096;
        const channelCount = 2;
        const references = [
          new AudioBuffer({ numberOfChannels: channelCount, length: currentFrames, sampleRate }),
          new AudioBuffer({ numberOfChannels: channelCount, length: nextFrames, sampleRate })
        ];
        const expectedMarkers = [];
        let markerIndex = 0;
        for (let track = 0; track < references.length; track++) {
          const reference = references[track];
          for (let channel = 0; channel < channelCount; channel++) {
            const plane = reference.getChannelData(channel);
            for (let frame = 0; frame < reference.length; frame++) {
              // Every ordinary sample is intentionally nonzero, so any zero run is a gap.
              plane[frame] = 0.1 + ((frame * 67 + track * 173 + channel * 313) % 1301) / 2602;
            }
          }
          for (let frame = 0; frame < reference.length; frame += markerInterval) {
            const value = -0.9 + markerIndex / 5120;
            reference.getChannelData(0)[frame] = value;
            expectedMarkers.push({ frame: track === 0 ? frame : currentFrames + frame, value });
            markerIndex++;
          }
        }
        const encoder = new AudioEncoder();
        const outputs = await Promise.all(references.map(reference => encoder.encode(reference, {
          format: 'wav', sampleRate, wavSampleFormat: 'pcm16'
        })));
        let context = null;
        let capture = null;
        let current = null;
        let next = null;
        try {
          context = new AudioContext({ sampleRate });
          await context.audioWorklet.addModule('/tests/rolling-pcm-capture-worklet.js');
          capture = new AudioWorkletNode(context, 'rolling-pcm-capture', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit'
          });
          const blocks = [];
          capture.port.onmessage = event => blocks.push(event.data);
          capture.connect(context.destination);
          let currentEnded = 0;
          let nextEnded = 0;
          let resolveNextEnded;
          const nextEndedPromise = new Promise(resolve => { resolveNextEnded = resolve; });
          let rejectPlayback;
          const playbackFailure = new Promise((_, reject) => { rejectPlayback = reject; });
          current = new RollingPcmTransport(context, {
            onEnded: () => { currentEnded++; },
            onFailure: failure => rejectPlayback(new Error(`current transport failed: ${failure.reason}`))
          });
          next = new RollingPcmTransport(context, {
            reservationRole: 'next',
            onEnded: () => {
              nextEnded++;
              resolveNextEnded();
            },
            onFailure: failure => rejectPlayback(new Error(`next transport failed: ${failure.reason}`))
          });
          await Promise.all([
            current.prepare({
              sourceKind: 'blob', blob: outputs[0].blob,
              byteLength: outputs[0].blob.size, format: 'wav'
            }),
            next.prepare({
              sourceKind: 'blob', blob: outputs[1].blob,
              byteLength: outputs[1].blob.size, format: 'wav'
            })
          ]);
          current.connect(capture);
          next.connect(capture);
          await context.resume();
          const startFrame = Math.ceil((context.currentTime + 0.25) * sampleRate / 128) * 128;
          const boundaryFrame = startFrame + currentFrames;
          const currentSlabFrames = current.profile.slabFrames;
          const nextSlabFrames = next.profile.slabFrames;
          const currentActivated = current.activate({ when: startFrame / sampleRate, frame: 0 });
          const nextActivated = next.activate({ when: boundaryFrame / sampleRate, frame: 0 });
          let timeoutId;
          try {
            await Promise.race([
              nextEndedPromise,
              playbackFailure,
              new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('scheduled transport timeout')), 20000);
              })
            ]);
          } finally {
            clearTimeout(timeoutId);
          }
          await new Promise(resolve => setTimeout(resolve, 100));
          const actual = Array.from({ length: channelCount }, () => new Float32Array(totalFrames));
          const seen = new Uint8Array(totalFrames);
          for (const block of blocks) {
            const blockEnd = block.frame + (block.planes[0]?.length ?? 0);
            const from = Math.max(startFrame, block.frame);
            const to = Math.min(startFrame + totalFrames, blockEnd);
            for (let absolute = from; absolute < to; absolute++) {
              const target = absolute - startFrame;
              const sourceOffset = absolute - block.frame;
              seen[target]++;
              for (let channel = 0; channel < channelCount; channel++) {
                actual[channel][target] = block.planes[channel][sourceOffset];
              }
            }
          }
          let maxError = 0;
          let longestZeroRun = 0;
          let zeroRun = 0;
          for (let channel = 0; channel < channelCount; channel++) {
            for (let frame = 0; frame < totalFrames; frame++) {
              const expected = frame < currentFrames
                ? references[0].getChannelData(channel)[frame]
                : references[1].getChannelData(channel)[frame - currentFrames];
              const error = Math.abs(expected - actual[channel][frame]);
              if (error > maxError) maxError = error;
              if (Math.abs(actual[channel][frame]) <= 1e-6) {
                zeroRun++;
                if (zeroRun > longestZeroRun) longestZeroRun = zeroRun;
              } else {
                zeroRun = 0;
              }
            }
          }
          const actualMarkers = [];
          for (let frame = 0; frame < totalFrames; frame++) {
            if (actual[0][frame] < -0.6) actualMarkers.push({ frame, value: actual[0][frame] });
          }
          const beforeDispose = {
            current: current.getDiagnosticSnapshot(),
            next: next.getDiagnosticSnapshot()
          };
          await current.dispose();
          await next.dispose();
          return {
            slabFrames,
            currentSlabFrames,
            nextSlabFrames,
            currentActivated,
            nextActivated,
            currentFrames,
            nextFrames,
            totalFrames,
            observedLogicalFrames: seen.reduce((count, value) => count + (value === 1 ? 1 : 0), 0),
            missingFrames: seen.reduce((count, value) => count + (value === 0 ? 1 : 0), 0),
            duplicateFrames: seen.reduce((count, value) => count + (value > 1 ? 1 : 0), 0),
            maxError,
            longestZeroRun,
            expectedMarkers,
            actualMarkers,
            currentEnded,
            nextEnded,
            beforeDispose,
            afterDispose: {
              current: current.getDiagnosticSnapshot(),
              next: next.getDiagnosticSnapshot()
            }
          };
        } finally {
          await current?.dispose();
          await next?.dispose();
          capture?.port.postMessage({ type: 'set-enabled', enabled: false });
          capture?.disconnect();
          await context?.close();
        }
      });
      assert.equal(result.slabFrames, 96000);
      assert.equal(result.currentSlabFrames, result.slabFrames);
      assert.equal(result.nextSlabFrames, result.slabFrames);
      assert.equal(result.currentActivated, true);
      assert.equal(result.nextActivated, true);
      assert.equal(result.currentFrames, 192000);
      assert.equal(result.nextFrames, 96000);
      assert.equal(result.totalFrames, 288000);
      assert.equal(result.observedLogicalFrames, result.totalFrames);
      assert.equal(result.missingFrames, 0);
      assert.equal(result.duplicateFrames, 0);
      assert.ok(result.maxError < 0.00004, `captured max error ${result.maxError}`);
      assert.equal(result.longestZeroRun, 0);
      assert.deepEqual(result.actualMarkers.map(marker => marker.frame),
        result.expectedMarkers.map(marker => marker.frame));
      for (let index = 0; index < result.expectedMarkers.length; index++) {
        assert.ok(Math.abs(result.actualMarkers[index].value - result.expectedMarkers[index].value) < 0.00004,
          `marker ${index} did not preserve its PCM value`);
      }
      assert.equal(result.currentEnded, 1);
      assert.equal(result.nextEnded, 1);
      assert.equal(result.beforeDispose.current.underruns, 0);
      assert.equal(result.beforeDispose.next.underruns, 0);
      assert.equal(result.afterDispose.current.liveAudioBuffers, 0);
      assert.equal(result.afterDispose.current.liveSourceNodes, 0);
      assert.equal(result.afterDispose.next.liveAudioBuffers, 0);
      assert.equal(result.afterDispose.next.liveSourceNodes, 0);
    } finally {
      await page?.close();
      await browser?.close();
      await fixtureServer.close();
    }
  });

test('rolling worker reproduces same-rate WAV and FLAC reference PCM in Chromium',
  { timeout: 120_000 }, async () => {
    const fixtureServer = await startFixtureServer();
    let browser = null;
    let page = null;
    const pageErrors = [];
    try {
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage();
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(fixtureServer.baseURL);
      const results = await page.evaluate(async () => {
        const [{ AudioEncoder }, { RollingPcmTransport }] = await Promise.all([
          import('/js/audio/audio-encoder.js'),
          import('/js/ui/audio-player/rolling-pcm-transport.js')
        ]);
        const sampleRate = 48000;
        const channelCount = 2;
        const frameCount = 12000;
        const reference = new AudioBuffer({
          numberOfChannels: channelCount,
          length: frameCount,
          sampleRate
        });
        for (let channel = 0; channel < channelCount; channel++) {
          const plane = reference.getChannelData(channel);
          for (let frame = 0; frame < frameCount; frame++) {
            const tone = Math.sin(2 * Math.PI * (997 + channel * 214) * frame / sampleRate);
            const marker = frame % 997 === channel * 37 ? 0.125 : 0;
            plane[frame] = 0.45 * tone + marker;
          }
        }
        const encoder = new AudioEncoder();
        const outputs = [];
        for (const format of ['wav', 'flac']) {
          const encoded = await encoder.encode(reference, {
            format,
            sampleRate,
            wavSampleFormat: 'pcm16',
            flacSampleFormat: 'pcm16'
          });
          const context = new OfflineAudioContext(channelCount, frameCount, sampleRate);
          let ended = 0;
          const transport = new RollingPcmTransport(context, { onEnded: () => ended++ });
          const metadata = await transport.prepare({
            sourceKind: 'blob',
            blob: encoded.blob,
            byteLength: encoded.blob.size,
            format
          });
          transport.connect(context.destination);
          if (!transport.activate({ when: 0, frame: 0 })) {
            throw new Error(`Failed to activate ${format} transport`);
          }
          const rendered = await context.startRendering();
          await new Promise(resolve => setTimeout(resolve, 0));
          let maxError = 0;
          for (let channel = 0; channel < channelCount; channel++) {
            const expected = reference.getChannelData(channel);
            const actual = rendered.getChannelData(channel);
            for (let frame = 0; frame < frameCount; frame++) {
              const error = Math.abs(expected[frame] - actual[frame]);
              if (error > maxError) maxError = error;
            }
          }
          const beforeDispose = transport.getDiagnosticSnapshot();
          await transport.dispose();
          outputs.push({
            format,
            metadata,
            maxError,
            ended,
            beforeDispose,
            afterDispose: transport.getDiagnosticSnapshot()
          });
        }
        return outputs;
      });

      for (const result of results) {
        assert.equal(result.metadata.sampleRate, 48000, result.format);
        assert.equal(result.metadata.channelCount, 2, result.format);
        assert.equal(result.metadata.totalFrames, 12000, result.format);
        assert.ok(result.maxError < 0.0001, `${result.format} max error ${result.maxError}`);
        assert.equal(result.beforeDispose.underruns, 0, result.format);
        assert.ok(result.beforeDispose.maxLivePcmBytes <= 12000 * 2 * 4, result.format);
        assert.equal(result.afterDispose.liveAudioBuffers, 0, result.format);
        assert.equal(result.afterDispose.liveSourceNodes, 0, result.format);
        assert.equal(result.afterDispose.terminateCount, 0, result.format);
      }
      assert.deepEqual(pageErrors, []);
    } finally {
      await page?.close();
      await browser?.close();
      await fixtureServer.close();
    }
  });

for (const [hostName, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`production policy falls back to media on ${hostName} because the enabled cell is Electron-only`,
    { timeout: 60_000 }, async () => {
      const fixtureServer = await startFixtureServer();
      let browser = null;
      let page = null;
      try {
        browser = await browserType.launch({ headless: true });
        page = await browser.newPage();
        await page.goto(fixtureServer.baseURL);
        const result = await page.evaluate(async () => {
          const policy = await import('/js/ui/audio-player/rolling-pcm-policy.js');
          const decision = policy.selectPlaybackBackend({
            snapshot: {
              sourceKind: 'bytes',
              bytes: new Uint8Array([1]),
              byteLength: 1024,
              format: 'wav',
              mediaSource: 'fixture.wav',
              legacyDecision: { mode: 'buffer', allowMediaFallback: true, reason: 'legacy' }
            },
            metadata: { durationSec: 600, sampleRate: 48000, channelCount: 2 },
            audioContext: { sampleRate: 48000 }
          });
          const path = 'C:\\SyntheticCatalog\\fixture.wav';
          const pathSnapshot = policy.createCanonicalPlaybackSourceSnapshot(
            { name: 'Extensionless display', fileName: 'fixture.wav', sourceFileName: 'fixture.wav', path },
            { mediaSource: path, byteLength: 1024, readBytes: () => {} },
            { mode: 'media', allowMediaFallback: false, reason: 'legacy-media' }
          );
          const hostCapability = { lifecycle: 'foreground', workerAvailable: true, audioDecoderAvailable: false };
          const electronCapability = {
            ...hostCapability,
            host: 'electron',
            electronMajorVersion: 44,
            chromiumMajorVersion: 152
          };
          const preflight = policy.selectPlaybackBackend({
            snapshot: pathSnapshot,
            metadata: { durationSec: null, sampleRate: null, channelCount: null },
            audioContext: { sampleRate: 96000 },
            capability: hostCapability
          });
          return {
            detectedHost: policy.detectRollingHost(),
            decision,
            preflight,
            hostCandidate: policy.hasRollingMatrixCandidate(pathSnapshot,
              policy.PRODUCTION_ROLLING_ENABLED_MATRIX, hostCapability),
            electronCandidate: policy.hasRollingMatrixCandidate(pathSnapshot,
              policy.PRODUCTION_ROLLING_ENABLED_MATRIX, electronCapability),
            productionMode: policy.PRODUCTION_ROLLING_POLICY_MODE,
            selectedProfileId: policy.SELECTED_ROLLING_PCM_PROFILE_ID,
            enabledCells: policy.PRODUCTION_ROLLING_ENABLED_MATRIX.length,
            enabledHost: policy.PRODUCTION_ROLLING_ENABLED_MATRIX[0]?.host ?? null
          };
        });
        assert.equal(result.detectedHost, hostName);
        assert.equal(result.productionMode, 'limitedRolling');
        assert.equal(result.selectedProfileId, 'memory-first');
        assert.equal(result.enabledCells, 1);
        assert.equal(result.enabledHost, 'electron');
        assert.equal(result.decision.mode, 'media');
        assert.equal(result.decision.reason, 'resource-safe-media');
        assert.equal(result.decision.rollingRejection, 'canonical-source-ineligible');
        assert.equal(result.preflight.mode, 'media');
        assert.equal(result.preflight.reason, 'resource-safe-media');
        assert.equal(result.preflight.rollingRejection, 'verified-codec-unsupported');
        assert.equal(result.preflight.rollingCandidate, undefined);
        assert.equal(result.hostCandidate, false);
        assert.equal(result.electronCandidate, true);
      } finally {
        await page?.close();
        await browser?.close();
        await fixtureServer.close();
      }
    });
}
