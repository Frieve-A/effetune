import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { _electron as electron, chromium } from 'playwright';

const repoRoot = path.resolve('.');
const captureWorkletSource = `
class RollingPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sequence = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    for (let channel = 0; channel < output.length; channel++) {
      if (input[channel]) output[channel].set(input[channel]);
      else output[channel].fill(0);
    }
    if (input.length > 0) {
      const planes = input.map(plane => plane.slice());
      this.port.postMessage(
        { sequence: this.sequence++, frame: currentFrame, planes },
        planes.map(plane => plane.buffer)
      );
    }
    return true;
  }
}
registerProcessor('rolling-pcm-capture', RollingPcmCaptureProcessor);
`;
const electronFixtureModuleSource = `
export function createStrictPcm16StereoWave(profile, sourceFrames, seed) {
  const channelCount = profile.channelCount;
  const dataBytes = sourceFrames * channelCount * Int16Array.BYTES_PER_ELEMENT;
  const wav = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(wav);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, profile.sourceSampleRate, true);
  view.setUint32(28, profile.sourceSampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let frame = 0; frame < sourceFrames; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const value = ((frame * seed + channel * 1291 + (frame % 17) * 97) % 65535) - 32767;
      view.setInt16(44 + (frame * channelCount + channel) * 2, value, true);
    }
  }
  return wav;
}

export function createCatalogPathFixture(policy, wav, index) {
  const fileName = 'catalog-' + index + '.wav';
  const track = Object.freeze({
    name: 'Extensionless catalog display ' + index,
    title: 'Extensionless catalog title ' + index,
    fileName,
    sourceFileName: fileName,
    path: 'C:\\\\SyntheticCatalog\\\\' + fileName,
    sourceKind: 'electron-file',
    byteLength: wav.byteLength
  });
  const descriptor = Object.freeze({ byteLength: wav.byteLength, mediaSource: track.path });
  const legacyDecision = Object.freeze({
    mode: 'buffer', allowMediaFallback: true, reason: 'legacy'
  });
  return Object.freeze({
    track,
    descriptor,
    snapshot: policy.createCanonicalPlaybackSourceSnapshot(track, descriptor, legacyDecision)
  });
}

export function collectQueuedPcm(transport, startFrame, endFrame, channelCount = 2) {
  const records = [...transport.queue]
    .filter(record => record.startFrame >= startFrame && record.startFrame < endFrame)
    .sort((left, right) => left.startFrame - right.startFrame);
  const planes = Array.from(
    { length: channelCount },
    () => new Float32Array(endFrame - startFrame)
  );
  const coverage = new Uint8Array(endFrame - startFrame);
  for (const record of records) {
    const relativeStart = record.startFrame - startFrame;
    for (let channel = 0; channel < channelCount; channel++) {
      planes[channel].set(record.audioBuffer.getChannelData(channel), relativeStart);
    }
    for (let frame = relativeStart; frame < relativeStart + record.frameCount; frame++) {
      coverage[frame]++;
    }
  }
  return {
    planes,
    coverage,
    intervals: records.map(record => [record.startFrame, record.startFrame + record.frameCount])
  };
}

export function firstBitMismatch(left, right) {
  if (left.length !== right.length) return -1;
  const leftBits = new Uint32Array(left.buffer, left.byteOffset, left.length);
  const rightBits = new Uint32Array(right.buffer, right.byteOffset, right.length);
  for (let frame = 0; frame < left.length; frame++) {
    if (leftBits[frame] !== rightBits[frame]) return frame;
  }
  return null;
}

export function inspectNativeBoundary(planes, reference, boundaryFrame) {
  const scores = [];
  for (let shift = -2; shift <= 2; shift++) {
    let squareError = 0;
    let compared = 0;
    for (let channel = 0; channel < planes.length; channel++) {
      const expected = reference.getChannelData(channel);
      for (let frame = boundaryFrame - 128; frame < boundaryFrame + 128; frame++) {
        const referenceFrame = frame + shift;
        if (referenceFrame < 0 || referenceFrame >= expected.length) continue;
        const difference = planes[channel][frame] - expected[referenceFrame];
        squareError += difference * difference;
        compared++;
      }
    }
    scores.push({ shift, mse: squareError / compared });
  }
  scores.sort((left, right) => left.mse - right.mse ||
    Math.abs(left.shift) - Math.abs(right.shift));
  let maxDeltaError = 0;
  for (let channel = 0; channel < planes.length; channel++) {
    const expected = reference.getChannelData(channel);
    const actualDelta = planes[channel][boundaryFrame] - planes[channel][boundaryFrame - 1];
    const expectedDelta = expected[boundaryFrame] - expected[boundaryFrame - 1];
    maxDeltaError = Math.max(maxDeltaError, Math.abs(actualDelta - expectedDelta));
  }
  return { bestShift: scores[0].shift, maxDeltaError };
}

export function joinPcmPlanes(left, right) {
  return left.map((plane, channel) => {
    const joined = new Float32Array(plane.length + right[channel].length);
    joined.set(plane);
    joined.set(right[channel], plane.length);
    return joined;
  });
}

export function joinAudioBuffers(left, right) {
  return {
    length: left.length + right.length,
    getChannelData(channel) {
      const joined = new Float32Array(this.length);
      joined.set(left.getChannelData(channel));
      joined.set(right.getChannelData(channel), left.length);
      return joined;
    }
  };
}
`;

function assertTransportResourcesReleased(snapshot, label) {
  for (const key of [
    'livePcmBytes',
    'liveAudioBuffers',
    'liveSourceNodes',
    'liveWorkers',
    'liveHandlers',
    'liveTimers',
    'liveObjectUrls',
    'liveFragmentInputBytes',
    'queuedAudioBuffers',
    'scheduledSourceNodes'
  ]) {
    assert.equal(snapshot[key], 0, `${label} ${key}`);
  }
}

async function startWorkerServer() {
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
      if (pathname === '/tests/rolling-pcm-electron-fixture.mjs') {
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/javascript; charset=utf-8'
        });
        response.end(electronFixtureModuleSource);
        return;
      }
      if (pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Rolling PCM Worker flow control</title>');
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
        'Content-Type': ['.js', '.mjs'].includes(path.extname(filePath))
          ? 'text/javascript; charset=utf-8'
          : 'application/octet-stream'
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

async function startElectronPage(baseURL) {
  const tempRoot = await realpath(await mkdtemp(path.join(
    os.tmpdir(),
    'effetune-native-fragment-electron-'
  )));
  const mainPath = path.join(
    repoRoot,
    'tests',
    'esm',
    'rolling-pcm-native-fragment-electron-main.cjs'
  );
  let application = null;
  try {
    application = await electron.launch({
      args: [`--user-data-dir=${path.join(tempRoot, 'profile')}`, mainPath],
      env: {
        ...process.env,
        EFFETUNE_FRAGMENT_TEST_URL: baseURL,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      timeout: 20_000
    });
    return {
      application,
      page: await application.firstWindow(),
      async close() {
        await application.close();
        await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    };
  } catch (error) {
    await application?.close().catch(() => {});
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw error;
  }
}

async function exposeElectronProcessMemorySampler(runtime) {
  await runtime.page.exposeFunction('sampleElectronProcessMemory', () =>
    runtime.application.evaluate(async ({ app }) => {
      const entries = app.getAppMetrics().map(metric => Object.freeze({
        type: metric.type,
        pid: metric.pid,
        serviceName: metric.serviceName ?? null,
        creationTime: metric.creationTime ?? null,
        workingSetBytes: Math.round((metric.memory?.workingSetSize ?? 0) * 1024),
        peakWorkingSetBytes: Math.round((metric.memory?.peakWorkingSetSize ?? 0) * 1024),
        privateBytes: Math.round((metric.memory?.privateBytes ?? 0) * 1024),
        sharedBytes: Math.round((metric.memory?.sharedBytes ?? 0) * 1024)
      }));
      return {
        entries,
        mainProcessMemory: await process.getProcessMemoryInfo(),
        mainHeap: process.memoryUsage(),
        totalWorkingSetBytes: entries.reduce(
          (total, entry) => total + entry.workingSetBytes,
          0
        ),
        // The OS keeps every process's working-set high-water mark, so the sum
        // is the continuously observed peak rather than a sampled maximum.
        totalPeakWorkingSetBytes: entries.reduce(
          (total, entry) => total + entry.peakWorkingSetBytes,
          0
        )
      };
    }));
}

test('production Worker holds one authenticated transferred fragment credit',
  { timeout: 120_000 }, async () => {
    const fixtureServer = await startWorkerServer();
    let browser = null;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(fixtureServer.baseURL);
      const result = await page.evaluate(async () => {
        const protocol = await import('/js/ui/audio-player/rolling-pcm-protocol.js');
        const core = await import('/js/ui/audio-player/rolling-pcm-core.js');
        const sampleRate = 44100;
        const outputSampleRate = 96000;
        const channelCount = 2;
        const totalFrames = 44100;
        const slabFrames = 128;
        const dataBytes = totalFrames * channelCount * Int16Array.BYTES_PER_ELEMENT;
        const wav = new ArrayBuffer(44 + dataBytes);
        const view = new DataView(wav);
        const writeAscii = (offset, value) => {
          for (let index = 0; index < value.length; index++) {
            view.setUint8(offset + index, value.charCodeAt(index));
          }
        };
        writeAscii(0, 'RIFF');
        view.setUint32(4, 36 + dataBytes, true);
        writeAscii(8, 'WAVE');
        writeAscii(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channelCount, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * channelCount * 2, true);
        view.setUint16(32, channelCount * 2, true);
        view.setUint16(34, 16, true);
        writeAscii(36, 'data');
        view.setUint32(40, dataBytes, true);
        for (let frame = 0; frame < totalFrames; frame++) {
          for (let channel = 0; channel < channelCount; channel++) {
            view.setInt16(44 + (frame * channelCount + channel) * 2,
              ((frame * 97 + channel * 503) % 65535) - 32767, true);
          }
        }
        const secondSource = wav.slice(0);
        const genericSampleRate = 48000;
        const genericTotalFrames = 256;
        const genericDataBytes = genericTotalFrames * channelCount * Int16Array.BYTES_PER_ELEMENT;
        const genericSource = new ArrayBuffer(44 + genericDataBytes);
        const genericView = new DataView(genericSource);
        const writeGenericAscii = (offset, value) => {
          for (let index = 0; index < value.length; index++) {
            genericView.setUint8(offset + index, value.charCodeAt(index));
          }
        };
        writeGenericAscii(0, 'RIFF');
        genericView.setUint32(4, 36 + genericDataBytes, true);
        writeGenericAscii(8, 'WAVE');
        writeGenericAscii(12, 'fmt ');
        genericView.setUint32(16, 16, true);
        genericView.setUint16(20, 1, true);
        genericView.setUint16(22, channelCount, true);
        genericView.setUint32(24, genericSampleRate, true);
        genericView.setUint32(28, genericSampleRate * channelCount * 2, true);
        genericView.setUint16(32, channelCount * 2, true);
        genericView.setUint16(34, 16, true);
        writeGenericAscii(36, 'data');
        genericView.setUint32(40, genericDataBytes, true);

        const ids = { transportId: 'real-worker-flow', generation: 1, segmentId: 'current' };
        const worker = new Worker('/js/vendor/rolling-pcm-decoder-worker.mjs', { type: 'module' });
        const events = [];
        let workerError = null;
        worker.onmessage = event => events.push(event.data);
        worker.onerror = event => { workerError = event.message || 'worker-error'; };
        const waitFor = async predicate => {
          const deadline = performance.now() + 15000;
          while (performance.now() < deadline) {
            if (workerError) throw new Error(workerError);
            const match = events.find(predicate);
            if (match) return match;
            await new Promise(resolve => setTimeout(resolve, 5));
          }
          throw new Error(`worker-event-timeout:${JSON.stringify(events.map(event => ({
            type: event.type,
            generation: event.generation,
            slabId: event.slabId,
            frameCount: event.frameCount,
            totalFrames: event.totalFrames,
            code: event.code
          })))}`);
        };
        const post = (type, commandIds, payload = {}, transfer = []) => {
          worker.postMessage(protocol.createRollingPcmEnvelope(type, commandIds, payload), transfer);
        };

        post(protocol.RollingPcmCommand.OPEN, ids, {
          sourceKind: 'bytes',
          source: wav,
          slabFrames,
          freePoolPerSizeClass: 1,
          outputSampleRate,
          decoderProfile: core.PCM16_STEREO_44100_TO_96000_PROFILE.codec,
          resamplerProfile: core.PCM16_STEREO_44100_TO_96000_PROFILE.id
        }, [wav]);
        const ready = await waitFor(event => event.type === protocol.RollingPcmEvent.READY);
        post(protocol.RollingPcmCommand.FILL, ids, { targetFrame: ready.totalFrames });

        const received = [];
        let liveTransferredFragments = 0;
        let liveTransferredBytes = 0;
        let maxLiveTransferredFragments = 0;
        let maxLiveTransferredBytes = 0;
        const receiveFragment = async index => {
          const fragment = await waitFor(event =>
            event.type === protocol.RollingPcmEvent.FRAGMENT &&
            !received.includes(event));
          received.push(fragment);
          liveTransferredFragments++;
          liveTransferredBytes += fragment.fragmentBytes.byteLength;
          maxLiveTransferredFragments = Math.max(
            maxLiveTransferredFragments,
            liveTransferredFragments
          );
          maxLiveTransferredBytes = Math.max(maxLiveTransferredBytes, liveTransferredBytes);
          if (fragment.fragmentId !== index + 1) {
            throw new Error('fragment-credit-sequence-invalid');
          }
          return fragment;
        };

        const first = await receiveFragment(0);
        post(protocol.RollingPcmCommand.RECYCLE, ids, {
          fragmentId: first.fragmentId,
          fragmentToken: `${first.fragmentToken}:forged`
        });
        await new Promise(resolve => setTimeout(resolve, 75));
        if (events.filter(event => event.type === protocol.RollingPcmEvent.FRAGMENT).length !== 1) {
          throw new Error('forged-credit-released-burst');
        }

        let fragment = first;
        const expectedFragmentCount = Math.ceil(
          ready.totalFrames / core.PCM16_STEREO_44100_TO_96000_PROFILE.logicalOutputFrames
        );
        for (let index = 0; index < expectedFragmentCount; index++) {
          if (index > 0) fragment = await receiveFragment(index);
          const byteCount = fragment.fragmentBytes.byteLength;
          post(protocol.RollingPcmCommand.RECYCLE, ids, {
            fragmentId: fragment.fragmentId,
            fragmentToken: fragment.fragmentToken
          });
          liveTransferredFragments--;
          liveTransferredBytes -= byteCount;
        }
        await waitFor(event => event.type === protocol.RollingPcmEvent.SEGMENT_END);
        const secondOpenIds = {
          transportId: ids.transportId,
          generation: 2,
          segmentId: 'second-segment'
        };
        post(protocol.RollingPcmCommand.OPEN, secondOpenIds, {
          sourceKind: 'bytes',
          source: secondSource,
          slabFrames,
          freePoolPerSizeClass: 1,
          outputSampleRate,
          decoderProfile: core.PCM16_STEREO_44100_TO_96000_PROFILE.codec,
          resamplerProfile: core.PCM16_STEREO_44100_TO_96000_PROFILE.id
        }, [secondSource]);
        const secondReady = await waitFor(event =>
          event.type === protocol.RollingPcmEvent.READY &&
          event.generation === secondOpenIds.generation &&
          event.segmentId === secondOpenIds.segmentId);
        post(protocol.RollingPcmCommand.FILL, secondOpenIds, {
          targetFrame: secondReady.totalFrames
        });
        await waitFor(event => event.type === protocol.RollingPcmEvent.FRAGMENT &&
          event.generation === secondOpenIds.generation &&
          event.segmentId === secondOpenIds.segmentId);
        const disposeIds = { ...secondOpenIds, generation: 3 };
        post(protocol.RollingPcmCommand.DISPOSE, disposeIds);
        await waitFor(event => event.type === protocol.RollingPcmEvent.DISPOSED &&
          event.generation === disposeIds.generation);
        const genericIds = {
          transportId: ids.transportId,
          generation: 5,
          segmentId: 'generic-same-rate'
        };
        post(protocol.RollingPcmCommand.OPEN, genericIds, {
          sourceKind: 'bytes',
          source: genericSource,
          slabFrames,
          freePoolPerSizeClass: 1
        }, [genericSource]);
        const genericReady = await waitFor(event =>
          event.type === protocol.RollingPcmEvent.READY &&
          event.generation === genericIds.generation &&
          event.segmentId === genericIds.segmentId);
        post(protocol.RollingPcmCommand.FILL, genericIds, {
          targetFrame: genericReady.totalFrames
        });
        const genericSlabs = [];
        while (genericSlabs.length < 2) {
          const slab = await waitFor(event => event.type === protocol.RollingPcmEvent.SLAB &&
            event.generation === genericIds.generation && !genericSlabs.includes(event));
          genericSlabs.push(slab);
          post(protocol.RollingPcmCommand.RECYCLE, genericIds, {
            slabId: slab.slabId,
            planes: slab.planes
          }, slab.planes);
        }
        await waitFor(event => event.type === protocol.RollingPcmEvent.SEGMENT_END &&
          event.generation === genericIds.generation);
        const genericDisposeIds = { ...genericIds, generation: 6 };
        post(protocol.RollingPcmCommand.DISPOSE, genericDisposeIds);
        await waitFor(event => event.type === protocol.RollingPcmEvent.DISPOSED &&
          event.generation === genericDisposeIds.generation);
        worker.terminate();
        return {
          fragmentCount: received.length,
          expectedFragmentCount,
          staleGenerationFragments: events.filter(event =>
            event.type === protocol.RollingPcmEvent.FRAGMENT &&
            event.generation === disposeIds.generation).length,
          maxLiveTransferredFragments,
          maxLiveTransferredBytes,
          genericSampleRate: genericReady.sampleRate,
          genericSlabFrames: genericSlabs.map(slab => slab.frameCount),
          finalLiveTransferredFragments: liveTransferredFragments,
          finalLiveTransferredBytes: liveTransferredBytes
        };
      });

      assert.equal(result.fragmentCount, result.expectedFragmentCount);
      assert.equal(result.staleGenerationFragments, 0);
      assert.equal(result.maxLiveTransferredFragments, 1);
      assert.equal(result.maxLiveTransferredBytes, 176444);
      assert.equal(result.genericSampleRate, 48000);
      assert.deepEqual(result.genericSlabFrames, [128, 128]);
      assert.deepEqual({
        fragments: result.finalLiveTransferredFragments,
        bytes: result.finalLiveTransferredBytes
      }, { fragments: 0, bytes: 0 });
    } finally {
      await browser?.close();
      await fixtureServer.close();
    }
  });

test('native fragment transport emits exact intervals and deterministic guarded decode',
  { timeout: 120_000 }, async () => {
    const fixtureServer = await startWorkerServer();
    let browser = null;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(fixtureServer.baseURL);
      const result = await page.evaluate(async () => {
        const core = await import('/js/ui/audio-player/rolling-pcm-core.js');
        const sourceSampleRate = 44100;
        const outputSampleRate = 96000;
        const channelCount = 2;
        const sourceFrames = 133770;
        const dataBytes = sourceFrames * channelCount * Int16Array.BYTES_PER_ELEMENT;
        const wav = new ArrayBuffer(44 + dataBytes);
        const view = new DataView(wav);
        const writeAscii = (offset, value) => {
          for (let index = 0; index < value.length; index++) {
            view.setUint8(offset + index, value.charCodeAt(index));
          }
        };
        writeAscii(0, 'RIFF');
        view.setUint32(4, 36 + dataBytes, true);
        writeAscii(8, 'WAVE');
        writeAscii(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channelCount, true);
        view.setUint32(24, sourceSampleRate, true);
        view.setUint32(28, sourceSampleRate * channelCount * 2, true);
        view.setUint16(32, channelCount * 2, true);
        view.setUint16(34, 16, true);
        writeAscii(36, 'data');
        view.setUint32(40, dataBytes, true);
        for (let frame = 0; frame < sourceFrames; frame++) {
          for (let channel = 0; channel < channelCount; channel++) {
            const value = ((frame * 811 + channel * 1291 + (frame % 17) * 97) % 65535) - 32767;
            view.setInt16(44 + (frame * channelCount + channel) * 2, value, true);
          }
        }

        const transportModule = await import('/js/ui/audio-player/rolling-pcm-transport.js');
        const profile = core.PCM16_STEREO_44100_TO_96000_PROFILE;
        const contract = {
          outputSampleRate,
          decoderProfile: profile.codec,
          resamplerProfile: profile.id
        };
        const context = new AudioContext({ sampleRate: outputSampleRate });
        const nextWav = wav.slice(0);
        const nextView = new DataView(nextWav);
        for (let frame = 0; frame < sourceFrames; frame++) {
          for (let channel = 0; channel < channelCount; channel++) {
            const value = ((frame * 1237 + channel * 1877 + (frame % 23) * 151) % 65535) - 32767;
            nextView.setInt16(44 + (frame * channelCount + channel) * 2, value, true);
          }
        }
        const currentReference = await context.decodeAudioData(wav.slice(0));
        const nextReference = await context.decodeAudioData(nextWav.slice(0));

        const decodeRolling = async (sourceWav, startFrame = 0, endFrame = null) => {
          const bytes = new Uint8Array(sourceWav.slice(0));
          const transport = new transportModule.RollingPcmTransport(context);
          const metadata = await transport.prepare({
            sourceKind: 'bytes',
            bytes,
            byteLength: bytes.byteLength,
            canonicalIdentity: {}
          }, {
            ...contract,
            startFrame,
            minimumHeadFrames: profile.logicalOutputFrames
          });
          const targetFrame = endFrame ?? metadata.totalFrames;
          await transport.fillTo(targetFrame);
          const records = [...transport.queue]
            .filter(record => record.startFrame >= startFrame && record.startFrame < targetFrame)
            .sort((left, right) => left.startFrame - right.startFrame);
          const length = targetFrame - startFrame;
          const planes = Array.from({ length: channelCount }, () => new Float32Array(length));
          const coverage = new Uint8Array(length);
          const intervals = [];
          for (const record of records) {
            const relativeStart = record.startFrame - startFrame;
            for (let channel = 0; channel < channelCount; channel++) {
              planes[channel].set(record.audioBuffer.getChannelData(channel), relativeStart);
            }
            for (let frame = relativeStart; frame < relativeStart + record.frameCount; frame++) {
              coverage[frame]++;
            }
            intervals.push([record.startFrame, record.startFrame + record.frameCount]);
          }
          const diagnostics = transport.getDiagnosticSnapshot();
          await transport.dispose();
          return { metadata, planes, coverage: [...coverage], intervals, diagnostics };
        };
        const firstMismatch = (actual, expected) => {
          if (actual.length !== expected.length) return 0;
          const actualBits = new Uint32Array(actual.buffer, actual.byteOffset, actual.length);
          const expectedBits = new Uint32Array(expected.buffer, expected.byteOffset, expected.length);
          for (let frame = 0; frame < expected.length; frame++) {
            if (actualBits[frame] !== expectedBits[frame]) return frame + 1;
          }
          return null;
        };
        const inspectBoundary = (planes, reference, boundaryFrame) => {
          const scores = [];
          for (let shift = -2; shift <= 2; shift++) {
            let squareError = 0;
            let compared = 0;
            for (let channel = 0; channel < channelCount; channel++) {
              const expected = reference.getChannelData(channel);
              for (let frame = boundaryFrame - 128; frame < boundaryFrame + 128; frame++) {
                const referenceFrame = frame + shift;
                if (referenceFrame < 0 || referenceFrame >= expected.length) continue;
                const difference = planes[channel][frame] - expected[referenceFrame];
                squareError += difference * difference;
                compared++;
              }
            }
            scores.push({ shift, mse: squareError / compared });
          }
          scores.sort((left, right) => left.mse - right.mse ||
            Math.abs(left.shift) - Math.abs(right.shift));
          let maxDeltaError = 0;
          for (let channel = 0; channel < channelCount; channel++) {
            const expected = reference.getChannelData(channel);
            const candidateDelta = planes[channel][boundaryFrame] - planes[channel][boundaryFrame - 1];
            const referenceDelta = expected[boundaryFrame] - expected[boundaryFrame - 1];
            maxDeltaError = Math.max(maxDeltaError, Math.abs(candidateDelta - referenceDelta));
          }
          return { bestShift: scores[0].shift, maxDeltaError };
        };

        const current = await decodeRolling(wav);
        const next = await decodeRolling(nextWav);
        const middleA = await decodeRolling(wav, 96000, 144000);
        const middleB = await decodeRolling(wav, 96000, 144000);
        const headMismatches = [current, next].map((track, index) => {
          const reference = index === 0 ? currentReference : nextReference;
          return track.planes.map((plane, channel) => firstMismatch(
            plane.subarray(0, profile.logicalOutputFrames),
            reference.getChannelData(channel).subarray(0, profile.logicalOutputFrames)
          ));
        });
        const repeatMismatches = middleA.planes.map((plane, channel) =>
          firstMismatch(plane, middleB.planes[channel]));
        const boundaries = [];
        for (let frame = profile.logicalOutputFrames; frame < current.metadata.totalFrames;
          frame += profile.logicalOutputFrames) {
          boundaries.push(inspectBoundary(current.planes, currentReference, frame));
        }
        const joinedPlanes = current.planes.map((plane, channel) => {
          const joined = new Float32Array(plane.length + next.planes[channel].length);
          joined.set(plane);
          joined.set(next.planes[channel], plane.length);
          return joined;
        });
        const joinedReference = {
          length: currentReference.length + nextReference.length,
          getChannelData(channel) {
            const joined = new Float32Array(this.length);
            joined.set(currentReference.getChannelData(channel));
            joined.set(nextReference.getChannelData(channel), currentReference.length);
            return joined;
          }
        };
        const currentNextBoundary = inspectBoundary(
          joinedPlanes,
          joinedReference,
          current.metadata.totalFrames
        );
        const suspiciousZeros = current.planes.reduce((count, plane, channel) => {
          const reference = currentReference.getChannelData(channel);
          for (let frame = 0; frame < plane.length; frame++) {
            if (plane[frame] === 0 && reference[frame] !== 0) count++;
          }
          return count;
        }, 0);
        const nonFinite = current.planes.reduce((count, plane) =>
          count + plane.reduce((sum, value) => sum + (Number.isFinite(value) ? 0 : 1), 0), 0);
        await context.close();
        return {
          runtime: navigator.userAgent,
          headMismatches,
          repeatMismatches,
          intervals: current.intervals,
          coverageExact: current.coverage.every(value => value === 1) &&
            next.coverage.every(value => value === 1),
          suspiciousZeros,
          nonFinite,
          boundaries,
          currentNextBoundary,
          maxFragmentInputBytes: Math.max(
            current.diagnostics.maxFragmentInputBytes,
            next.diagnostics.maxFragmentInputBytes
          ),
          maxFragmentDecodedPcmBytes: Math.max(
            current.diagnostics.maxFragmentDecodedPcmBytes,
            next.diagnostics.maxFragmentDecodedPcmBytes
          )
        };
      });

      assert.deepEqual(result.headMismatches, [[null, null], [null, null]]);
      assert.deepEqual(result.repeatMismatches, [null, null]);
      assert.equal(result.coverageExact, true);
      assert.equal(result.suspiciousZeros, 0);
      assert.equal(result.nonFinite, 0);
      assert.deepEqual(result.intervals, [
        [0, 48000], [48000, 96000], [96000, 144000],
        [144000, 192000], [192000, 240000], [240000, 288000], [288000, 291200]
      ]);
      for (const boundary of [...result.boundaries, result.currentNextBoundary]) {
        assert.equal(boundary.bestShift, 0);
        assert.ok(boundary.maxDeltaError <= 8 * (2 ** -23),
          `native seam delta ${boundary.maxDeltaError}`);
      }
      assert.equal(result.maxFragmentInputBytes, 264644);
      assert.equal(result.maxFragmentDecodedPcmBytes, 1152000);
    } finally {
      await browser?.close();
      await fixtureServer.close();
    }
  });

test('Electron 44 native fragments match full decode at the head and repeat exactly',
  { timeout: 120_000 }, async () => {
    const fixtureServer = await startWorkerServer();
    let runtime = null;
    try {
      runtime = await startElectronPage(fixtureServer.baseURL);
      const versions = await runtime.application.evaluate(() => ({
        electron: process.versions.electron,
        chromium: process.versions.chrome
      }));
      const result = await runtime.page.evaluate(async () => {
        const core = await import('/js/ui/audio-player/rolling-pcm-core.js');
        const { RollingPcmTransport } = await import(
          '/js/ui/audio-player/rolling-pcm-transport.js'
        );
        const profile = core.PCM16_STEREO_44100_TO_96000_PROFILE;
        const sourceFrames = 88201;
        const channelCount = 2;
        const dataBytes = sourceFrames * channelCount * Int16Array.BYTES_PER_ELEMENT;
        const wav = new ArrayBuffer(44 + dataBytes);
        const view = new DataView(wav);
        const writeAscii = (offset, value) => {
          for (let index = 0; index < value.length; index++) {
            view.setUint8(offset + index, value.charCodeAt(index));
          }
        };
        writeAscii(0, 'RIFF');
        view.setUint32(4, 36 + dataBytes, true);
        writeAscii(8, 'WAVE');
        writeAscii(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, channelCount, true);
        view.setUint32(24, profile.sourceSampleRate, true);
        view.setUint32(28, profile.sourceSampleRate * channelCount * 2, true);
        view.setUint16(32, channelCount * 2, true);
        view.setUint16(34, 16, true);
        writeAscii(36, 'data');
        view.setUint32(40, dataBytes, true);
        for (let frame = 0; frame < sourceFrames; frame++) {
          for (let channel = 0; channel < channelCount; channel++) {
            const value = ((frame * 811 + channel * 1291 + (frame % 17) * 97) % 65535) - 32767;
            view.setInt16(44 + (frame * channelCount + channel) * 2, value, true);
          }
        }
        const context = new AudioContext({ sampleRate: profile.outputSampleRate });
        const reference = await context.decodeAudioData(wav.slice(0));
        const probeSource = core.createPcm16WaveFragmentSource(wav.slice(0));
        const probeTail = probeSource.createFragment(192000, probeSource.totalFrames - 192000);
        const probeTailDecoded = await context.decodeAudioData(probeTail.fragmentBytes.slice(0));
        const contract = {
          outputSampleRate: profile.outputSampleRate,
          decoderProfile: profile.codec,
          resamplerProfile: profile.id
        };
        const decodeRange = async (startFrame, endFrame) => {
          const bytes = new Uint8Array(wav.slice(0));
          const transport = new RollingPcmTransport(context);
          await transport.prepare({
            sourceKind: 'bytes',
            bytes,
            byteLength: bytes.byteLength,
            canonicalIdentity: {}
          }, {
            ...contract,
            startFrame,
            minimumHeadFrames: profile.logicalOutputFrames
          });
          await transport.fillTo(endFrame);
          const records = [...transport.queue]
            .filter(record => record.startFrame >= startFrame && record.startFrame < endFrame)
            .sort((left, right) => left.startFrame - right.startFrame);
          const planes = Array.from(
            { length: channelCount },
            () => new Float32Array(endFrame - startFrame)
          );
          for (const record of records) {
            for (let channel = 0; channel < channelCount; channel++) {
              planes[channel].set(
                record.audioBuffer.getChannelData(channel),
                record.startFrame - startFrame
              );
            }
          }
          const intervals = records.map(record => [
            record.startFrame,
            record.startFrame + record.frameCount
          ]);
          const diagnostics = transport.getDiagnosticSnapshot();
          await transport.dispose();
          return { planes, intervals, diagnostics };
        };
        const full = await decodeRange(0, reference.length);
        const middleA = await decodeRange(48000, 96000);
        const middleB = await decodeRange(48000, 96000);
        const mismatch = (left, right) => {
          const leftBits = new Uint32Array(left.buffer, left.byteOffset, left.length);
          const rightBits = new Uint32Array(right.buffer, right.byteOffset, right.length);
          for (let frame = 0; frame < left.length; frame++) {
            if (leftBits[frame] !== rightBits[frame]) return frame;
          }
          return null;
        };
        const headMismatches = full.planes.map((plane, channel) => mismatch(
          plane.subarray(0, profile.logicalOutputFrames),
          reference.getChannelData(channel).subarray(0, profile.logicalOutputFrames)
        ));
        const repeatMismatches = middleA.planes.map((plane, channel) =>
          mismatch(plane, middleB.planes[channel]));
        await context.close();
        return {
          userAgent: navigator.userAgent,
          headMismatches,
          repeatMismatches,
          nativeLengths: {
            full: reference.length,
            plannedFull: probeSource.totalFrames,
            tail: probeTailDecoded.length,
            plannedTail: probeTail.decodedOutputFrameCount,
            crop: probeTail.cropStartFrame,
            logical: probeTail.outputFrameCount
          },
          intervals: full.intervals,
          maxFragmentInputBytes: full.diagnostics.maxFragmentInputBytes,
          maxFragmentDecodedPcmBytes: full.diagnostics.maxFragmentDecodedPcmBytes
        };
      });

      assert.equal(versions.electron.startsWith('44.'), true);
      assert.equal(versions.chromium.startsWith('152.'), true);
      assert.match(result.userAgent, /Electron\/44\./);
      assert.deepEqual(result.headMismatches, [null, null]);
      assert.deepEqual(result.repeatMismatches, [null, null]);
      assert.deepEqual(result.nativeLengths, {
        full: 192002,
        plannedFull: 192002,
        tail: 48002,
        plannedTail: 48002,
        crop: 48000,
        logical: 2
      });
      assert.deepEqual(result.intervals, [
        [0, 48000], [48000, 96000], [96000, 144000], [144000, 192000],
        [192000, 192002]
      ]);
      assert.equal(result.maxFragmentInputBytes, 264644);
      assert.equal(result.maxFragmentDecodedPcmBytes, 1152000);
    } finally {
      await runtime?.close();
      await fixtureServer.close();
    }
  });

test('Electron 44 isolated silent-sink PCM continuity cell preserves exact native fragments',
  { timeout: 120_000 }, async t => {
    const fixtureServer = await startWorkerServer();
    let runtime = null;
    try {
      runtime = await startElectronPage(fixtureServer.baseURL);
      const versions = await runtime.application.evaluate(() => ({
        electron: process.versions.electron,
        chromium: process.versions.chrome
      }));
      const result = await runtime.page.evaluate(async () => {
        const [core, policy, transportModule, fixture] = await Promise.all([
          import('/js/ui/audio-player/rolling-pcm-core.js'),
          import('/js/ui/audio-player/rolling-pcm-policy.js'),
          import('/js/ui/audio-player/rolling-pcm-transport.js'),
          import('/tests/rolling-pcm-electron-fixture.mjs')
        ]);
        const profile = core.PCM16_STEREO_44100_TO_96000_PROFILE;
        const candidateMatrix = [policy.PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.cell];
        const waves = [
          fixture.createStrictPcm16StereoWave(profile, 88200, 811),
          fixture.createStrictPcm16StereoWave(profile, 88200, 1237)
        ];
        const catalog = waves.map((wav, index) =>
          fixture.createCatalogPathFixture(policy, wav, index + 1));
        const capability = {
          host: 'electron',
          electronMajorVersion: 44,
          chromiumMajorVersion: 152,
          lifecycle: 'foreground',
          workerAvailable: true,
          audioDecoderAvailable: false
        };
        const context = new AudioContext({
          sampleRate: profile.outputSampleRate,
          sinkId: { type: 'none' }
        });
        if (context.sinkId?.type !== 'none') {
          throw new Error('Electron silent AudioContext sink is unavailable');
        }
        const nativeDecodeAudioData = context.decodeAudioData.bind(context);
        let referencePhase = true;
        let referenceFullDecodeCalls = 0;
        let nativeFragmentDecodeCalls = 0;
        let productionFullTrackDecodeCalls = 0;
        context.decodeAudioData = (source, ...args) => {
          if (referencePhase) referenceFullDecodeCalls++;
          else {
            nativeFragmentDecodeCalls++;
            if (waves.some(wav => wav.byteLength === source.byteLength)) {
              productionFullTrackDecodeCalls++;
            }
          }
          return nativeDecodeAudioData(source, ...args);
        };
        const references = await Promise.all(waves.map(wav => context.decodeAudioData(wav.slice(0))));
        referencePhase = false;
        let audioElementCalls = 0;
        let offlineContextCalls = 0;
        const NativeAudio = globalThis.Audio;
        const NativeOfflineAudioContext = globalThis.OfflineAudioContext;
        if (typeof NativeAudio === 'function') {
          globalThis.Audio = new Proxy(NativeAudio, {
            construct(target, args) {
              audioElementCalls++;
              return Reflect.construct(target, args);
            }
          });
        }
        if (typeof NativeOfflineAudioContext === 'function') {
          globalThis.OfflineAudioContext = new Proxy(NativeOfflineAudioContext, {
            construct(target, args) {
              offlineContextCalls++;
              return Reflect.construct(target, args);
            }
          });
        }
        const contract = {
          outputSampleRate: profile.outputSampleRate,
          decoderProfile: profile.codec,
          resamplerProfile: profile.id
        };
        const preflightDecisions = catalog.map(item => policy.selectPlaybackBackend({
          snapshot: item.snapshot,
          metadata: null,
          audioContext: context,
          policyMode: policy.RollingPolicyMode.LIMITED_ROLLING,
          enabledMatrix: candidateMatrix,
          capability
        }));
        const pathReads = [];
        const readCatalogBytes = index => {
          pathReads.push(catalog[index].track.path);
          return waves[index].slice(0);
        };
        const prepareOptions = index => ({
          ...contract,
          sourceOverride: { kind: 'bytes', bytes: readCatalogBytes(index) },
          minimumHeadFrames: profile.logicalOutputFrames
        });
        const prepareRange = async (startFrame, endFrame) => {
          const transport = new transportModule.RollingPcmTransport(context);
          await transport.prepare(catalog[0].snapshot, {
            ...prepareOptions(0),
            startFrame
          });
          await transport.fillTo(endFrame);
          const decoded = fixture.collectQueuedPcm(transport, startFrame, endFrame);
          const diagnostics = transport.getDiagnosticSnapshot();
          await transport.dispose();
          return { decoded, diagnostics, afterDispose: transport.getDiagnosticSnapshot() };
        };
        const ledger = new policy.RollingPcmAdmissionLedger();
        let current = null;
        let next = null;
        let capture = null;
        let captureContext = null;
        let currentEnded = 0;
        let nextEnded = 0;
        let transitionCount = 0;
        let transitionPromoted = false;
        let resolveNextEnded;
        const nextEndedPromise = new Promise(resolve => { resolveNextEnded = resolve; });
        let rejectPlayback;
        const playbackFailure = new Promise((_, reject) => { rejectPlayback = reject; });
        try {
          current = new transportModule.RollingPcmTransport(context, {
            reservationLedger: ledger,
            onEnded: () => {
              currentEnded++;
              transitionPromoted = next.promoteReservation(current);
              if (transitionPromoted) transitionCount++;
              else rejectPlayback(new Error('next reservation promotion failed'));
            },
            onFailure: failure => rejectPlayback(new Error(`current:${failure.reason}`))
          });
          await current.prepare(catalog[0].snapshot, prepareOptions(0));
          if (!current.promoteReservation()) throw new Error('current reservation promotion failed');
          next = new transportModule.RollingPcmTransport(context, {
            reservationLedger: ledger,
            reservationRole: 'next',
            onEnded: () => {
              nextEnded++;
              resolveNextEnded();
            },
            onFailure: failure => rejectPlayback(new Error(`next:${failure.reason}`))
          });
          await next.prepare(catalog[1].snapshot, prepareOptions(1));
          await Promise.all([
            current.fillTo(current.metadata.totalFrames),
            next.fillTo(next.metadata.totalFrames)
          ]);
          const decoded = [current, next].map(transport => fixture.collectQueuedPcm(
            transport,
            0,
            transport.metadata.totalFrames
          ));
          const postReadyDecisions = [current, next].map((transport, index) =>
            policy.selectPlaybackBackend({
              snapshot: catalog[index].snapshot,
              metadata: transport.metadata,
              audioContext: context,
              policyMode: policy.RollingPolicyMode.LIMITED_ROLLING,
              enabledMatrix: candidateMatrix,
              capability
            }));
          const middleA = await prepareRange(48000, 96000);
          const middleB = await prepareRange(48000, 96000);
          const headMismatches = decoded.map((track, index) => track.planes.map(
            (plane, channel) => fixture.firstBitMismatch(
              plane.subarray(0, profile.logicalOutputFrames),
              references[index].getChannelData(channel).subarray(0, profile.logicalOutputFrames)
            )
          ));
          const repeatMismatches = middleA.decoded.planes.map((plane, channel) =>
            fixture.firstBitMismatch(plane, middleB.decoded.planes[channel]));
          const seams = [];
          for (let trackIndex = 0; trackIndex < decoded.length; trackIndex++) {
            for (let frame = profile.logicalOutputFrames; frame < decoded[trackIndex].planes[0].length;
              frame += profile.logicalOutputFrames) {
              seams.push(fixture.inspectNativeBoundary(
                decoded[trackIndex].planes,
                references[trackIndex],
                frame
              ));
            }
          }
          const joinedPlanes = fixture.joinPcmPlanes(decoded[0].planes, decoded[1].planes);
          const joinedReference = fixture.joinAudioBuffers(references[0], references[1]);
          const currentNextBoundary = fixture.inspectNativeBoundary(
            joinedPlanes,
            joinedReference,
            decoded[0].planes[0].length
          );

          await current.dispose();
          await next.dispose();
          const captureLedger = new policy.RollingPcmAdmissionLedger();
          captureContext = new AudioContext({
            sampleRate: profile.outputSampleRate,
            sinkId: { type: 'none' }
          });
          if (captureContext.sinkId?.type !== 'none') {
            throw new Error('Electron silent capture AudioContext sink is unavailable');
          }
          current = new transportModule.RollingPcmTransport(captureContext, {
            reservationLedger: captureLedger,
            onEnded: () => {
              currentEnded++;
              transitionPromoted = next.promoteReservation(current);
              if (transitionPromoted) transitionCount++;
              else rejectPlayback(new Error('next reservation promotion failed'));
            },
            onFailure: failure => rejectPlayback(new Error(`current:${failure.reason}`))
          });
          await current.prepare(catalog[0].snapshot, {
            ...contract,
            sourceOverride: { kind: 'bytes', bytes: waves[0].slice(0) },
            minimumHeadFrames: profile.logicalOutputFrames
          });
          if (!current.promoteReservation()) {
            throw new Error('capture current reservation promotion failed');
          }
          next = new transportModule.RollingPcmTransport(captureContext, {
            reservationLedger: captureLedger,
            reservationRole: 'next',
            onEnded: () => {
              nextEnded++;
              resolveNextEnded();
            },
            onFailure: failure => rejectPlayback(new Error(`next:${failure.reason}`))
          });
          await next.prepare(catalog[1].snapshot, {
            ...contract,
            sourceOverride: { kind: 'bytes', bytes: waves[1].slice(0) },
            minimumHeadFrames: profile.logicalOutputFrames
          });
          await Promise.all([
            current.fillTo(current.metadata.totalFrames),
            next.fillTo(next.metadata.totalFrames)
          ]);
          await captureContext.audioWorklet.addModule('/tests/rolling-pcm-capture-worklet.js');
          capture = new AudioWorkletNode(captureContext, 'rolling-pcm-capture', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit'
          });
          const blocks = [];
          const currentFrames = current.metadata.totalFrames;
          const totalFrames = currentFrames + next.metadata.totalFrames;
          let captureStartSequence = null;
          let resolveCaptureComplete;
          const captureComplete = new Promise(resolve => { resolveCaptureComplete = resolve; });
          capture.port.onmessage = event => {
            blocks.push(event.data);
            const blockFrames = event.data.planes[0]?.length ?? 0;
            if (captureStartSequence === null && blockFrames > 0 &&
                event.data.planes.every((plane, channel) => {
                  const expected = joinedPlanes[channel];
                  for (let frame = 0; frame < blockFrames; frame++) {
                    if (Math.abs(plane[frame] - expected[frame]) >= 0.00004) return false;
                  }
                  return true;
                })) {
              captureStartSequence = event.data.sequence;
            }
            if (captureStartSequence !== null &&
                (event.data.sequence - captureStartSequence + 1) * blockFrames >= totalFrames) {
              resolveCaptureComplete();
            }
          };
          current.connect(capture);
          next.connect(capture);
          capture.connect(captureContext.destination);
          await captureContext.resume();
          const startFrame = Math.ceil((captureContext.currentTime + 0.2) *
            profile.outputSampleRate / 128) * 128;
          const currentActivated = current.activate({ when: startFrame / profile.outputSampleRate });
          const nextActivated = next.activate({
            when: (startFrame + currentFrames) / profile.outputSampleRate
          });
          let timeoutId;
          try {
            await Promise.race([
              nextEndedPromise,
              playbackFailure,
              new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('catalog transition timeout')), 12000);
              })
            ]);
          } finally {
            clearTimeout(timeoutId);
          }
          let captureTimeoutId;
          try {
            await Promise.race([
              captureComplete,
              new Promise((_, reject) => {
                captureTimeoutId = setTimeout(
                  () => reject(new Error('catalog capture drain timeout')),
                  12000
                );
              })
            ]);
          } finally {
            clearTimeout(captureTimeoutId);
          }
          const actual = Array.from({ length: profile.channelCount },
            () => new Float32Array(totalFrames));
          const messageCoverage = new Uint8Array(totalFrames);
          for (const block of blocks) {
            const blockFrames = block.planes[0]?.length ?? 0;
            const relativeStart = (block.sequence - captureStartSequence) * blockFrames;
            const from = Math.max(0, relativeStart);
            const to = Math.min(totalFrames, relativeStart + blockFrames);
            for (let target = from; target < to; target++) {
              const sourceOffset = target - relativeStart;
              messageCoverage[target]++;
              for (let channel = 0; channel < profile.channelCount; channel++) {
                actual[channel][target] = block.planes[channel][sourceOffset];
              }
            }
          }
          let captureMaxSampleError = 0;
          let captureMaxAdjacentDeltaError = 0;
          for (let channel = 0; channel < profile.channelCount; channel++) {
            for (let frame = 0; frame < totalFrames; frame++) {
              captureMaxSampleError = Math.max(
                captureMaxSampleError,
                Math.abs(actual[channel][frame] - joinedPlanes[channel][frame])
              );
              if (frame > 0) {
                const actualDelta = actual[channel][frame] - actual[channel][frame - 1];
                const expectedDelta = joinedPlanes[channel][frame] -
                  joinedPlanes[channel][frame - 1];
                captureMaxAdjacentDeltaError = Math.max(
                  captureMaxAdjacentDeltaError,
                  Math.abs(actualDelta - expectedDelta)
                );
              }
            }
          }
          const capturedReference = {
            getChannelData(channel) { return joinedPlanes[channel]; }
          };
          const captureBoundary = fixture.inspectNativeBoundary(
            actual,
            capturedReference,
            currentFrames
          );
          let suspiciousZeros = 0;
          let nonFinite = 0;
          for (let channel = 0; channel < profile.channelCount; channel++) {
            for (let frame = 0; frame < totalFrames; frame++) {
              if (actual[channel][frame] === 0 && joinedPlanes[channel][frame] !== 0) {
                suspiciousZeros++;
              }
              if (!Number.isFinite(actual[channel][frame])) nonFinite++;
            }
          }
          const beforeDispose = {
            current: current.getDiagnosticSnapshot(),
            next: next.getDiagnosticSnapshot()
          };
          await current.dispose();
          await next.dispose();
          return {
            userAgent: navigator.userAgent,
            sourceSnapshots: catalog.map(item => ({
              sourceKind: item.snapshot.sourceKind,
              format: item.snapshot.format,
              mediaSource: item.snapshot.mediaSource,
              hasBytes: item.snapshot.bytes !== null
            })),
            preflightDecisions,
            postReadyDecisions,
            pathReads,
            referenceFullDecodeCalls,
            nativeFragmentDecodeCalls,
            productionFullTrackDecodeCalls,
            offlineContextCalls,
            audioElementCalls,
            headMismatches,
            repeatMismatches,
            intervals: decoded.map(track => track.intervals),
            coverageExact: decoded.every(track => track.coverage.every(value => value === 1)),
            currentActivated,
            nextActivated,
            captureMaxSampleError,
            captureMaxAdjacentDeltaError,
            captureBoundary,
            captureContextFrameDeltaGaps: blocks.reduce((count, block, index) =>
              count + (index === 0 || block.frame - blocks[index - 1].frame === 128 ? 0 : 1), 0),
            capturePortDiagnostics: {
              sequenceGaps: blocks.reduce((count, block, index) =>
                count + (block.sequence === index ? 0 : 1), 0),
              missingFrames: messageCoverage.reduce(
                (count, value) => count + (value === 0 ? 1 : 0), 0),
              duplicateFrames: messageCoverage.reduce(
                (count, value) => count + (value > 1 ? 1 : 0), 0)
            },
            suspiciousZeros,
            nonFinite,
            seams,
            currentNextBoundary,
            currentEnded,
            nextEnded,
            transitionCount,
            transitionPromoted,
            maxFragmentInputBytes: Math.max(
              beforeDispose.current.maxFragmentInputBytes,
              beforeDispose.next.maxFragmentInputBytes,
              middleA.diagnostics.maxFragmentInputBytes,
              middleB.diagnostics.maxFragmentInputBytes
            ),
            maxFragmentDecodedPcmBytes: Math.max(
              beforeDispose.current.maxFragmentDecodedPcmBytes,
              beforeDispose.next.maxFragmentDecodedPcmBytes,
              middleA.diagnostics.maxFragmentDecodedPcmBytes,
              middleB.diagnostics.maxFragmentDecodedPcmBytes
            ),
            beforeDispose,
            afterDispose: {
              current: current.getDiagnosticSnapshot(),
              next: next.getDiagnosticSnapshot(),
              middleA: middleA.afterDispose,
              middleB: middleB.afterDispose
            }
          };
        } finally {
          await current?.dispose();
          await next?.dispose();
          capture?.disconnect();
          globalThis.Audio = NativeAudio;
          globalThis.OfflineAudioContext = NativeOfflineAudioContext;
          await captureContext?.close();
          await context.close();
        }
      });

      assert.equal(versions.electron.startsWith('44.'), true);
      assert.equal(versions.chromium.startsWith('152.'), true);
      assert.match(result.userAgent, /Electron\/44\./);
      assert.deepEqual(result.sourceSnapshots, [
        {
          sourceKind: 'other', format: 'wav',
          mediaSource: 'C:\\SyntheticCatalog\\catalog-1.wav', hasBytes: false
        },
        {
          sourceKind: 'other', format: 'wav',
          mediaSource: 'C:\\SyntheticCatalog\\catalog-2.wav', hasBytes: false
        }
      ]);
      assert.deepEqual(result.preflightDecisions.map(decision => ({
        mode: decision.mode,
        rollingCandidate: decision.rollingCandidate
      })), [
        { mode: 'media', rollingCandidate: true },
        { mode: 'media', rollingCandidate: true }
      ]);
      assert.deepEqual(result.postReadyDecisions.map(decision => decision.mode),
        ['rolling', 'rolling']);
      assert.deepEqual(result.pathReads, [
        'C:\\SyntheticCatalog\\catalog-1.wav',
        'C:\\SyntheticCatalog\\catalog-2.wav',
        'C:\\SyntheticCatalog\\catalog-1.wav',
        'C:\\SyntheticCatalog\\catalog-1.wav'
      ]);
      assert.deepEqual({
        referenceFullDecodeCalls: result.referenceFullDecodeCalls,
        nativeFragmentDecodeCalls: result.nativeFragmentDecodeCalls,
        productionFullTrackDecodeCalls: result.productionFullTrackDecodeCalls,
        offlineContextCalls: result.offlineContextCalls,
        audioElementCalls: result.audioElementCalls
      }, {
        referenceFullDecodeCalls: 2,
        nativeFragmentDecodeCalls: 10,
        productionFullTrackDecodeCalls: 0,
        offlineContextCalls: 0,
        audioElementCalls: 0
      });
      assert.deepEqual(result.headMismatches, [[null, null], [null, null]]);
      assert.deepEqual(result.repeatMismatches, [null, null]);
      assert.deepEqual(result.intervals, [
        [[0, 48000], [48000, 96000], [96000, 144000], [144000, 192000]],
        [[0, 48000], [48000, 96000], [96000, 144000], [144000, 192000]]
      ]);
      assert.equal(result.coverageExact, true);
      assert.equal(result.currentActivated, true);
      assert.equal(result.nextActivated, true);
      assert.ok(result.captureMaxSampleError < 0.00004,
        `captured max sample error ${result.captureMaxSampleError}; ${JSON.stringify({
          boundary: result.captureBoundary,
          contextFrameDeltaGaps: result.captureContextFrameDeltaGaps,
          capturePort: result.capturePortDiagnostics,
          suspiciousZeros: result.suspiciousZeros,
          currentEnded: result.currentEnded,
          nextEnded: result.nextEnded
        })}`);
      assert.ok(result.captureMaxAdjacentDeltaError < 0.00004,
        `captured max adjacent delta error ${result.captureMaxAdjacentDeltaError}`);
      assert.equal(result.captureBoundary.bestShift, 0);
      assert.ok(result.captureBoundary.maxDeltaError <= 8 * (2 ** -23),
        `captured transition delta ${result.captureBoundary.maxDeltaError}`);
      assert.deepEqual(result.capturePortDiagnostics, {
        sequenceGaps: 0,
        missingFrames: 0,
        duplicateFrames: 0
      });
      assert.equal(result.suspiciousZeros, 0);
      assert.equal(result.nonFinite, 0);
      for (const seam of [...result.seams, result.currentNextBoundary]) {
        assert.equal(seam.bestShift, 0);
        assert.ok(seam.maxDeltaError <= 8 * (2 ** -23),
          `native seam delta ${seam.maxDeltaError}`);
      }
      assert.deepEqual({
        currentEnded: result.currentEnded,
        nextEnded: result.nextEnded,
        transitionCount: result.transitionCount,
        transitionPromoted: result.transitionPromoted
      }, {
        currentEnded: 1,
        nextEnded: 1,
        transitionCount: 1,
        transitionPromoted: true
      });
      assert.equal(result.beforeDispose.current.underruns, 0);
      assert.equal(result.beforeDispose.next.underruns, 0);
      assert.equal(result.maxFragmentInputBytes, 264644);
      assert.equal(result.maxFragmentDecodedPcmBytes, 1152000);
      for (const [label, snapshot] of Object.entries(result.afterDispose)) {
        assertTransportResourcesReleased(snapshot, label);
      }
    } finally {
      await runtime?.close();
      await fixtureServer.close();
    }
  });

test('Electron 44 isolated 2048-fragment process-memory lifetime cell returns within grace',
  { timeout: 180_000 }, async t => {
    const fixtureServer = await startWorkerServer();
    let runtime = null;
    try {
      runtime = await startElectronPage(fixtureServer.baseURL);
      await exposeElectronProcessMemorySampler(runtime);
      const result = await runtime.page.evaluate(async () => {
        const [core, policy, transportModule, fixture] = await Promise.all([
          import('/js/ui/audio-player/rolling-pcm-core.js'),
          import('/js/ui/audio-player/rolling-pcm-policy.js'),
          import('/js/ui/audio-player/rolling-pcm-transport.js'),
          import('/tests/rolling-pcm-electron-fixture.mjs')
        ]);
        const profile = core.PCM16_STEREO_44100_TO_96000_PROFILE;
        const sampleProcessMemory = async () => ({
          ...await globalThis.sampleElectronProcessMemory(),
          rendererHeap: typeof performance.memory === 'object' ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
          } : null
        });
        const wave = fixture.createStrictPcm16StereoWave(
          profile,
          profile.sourceSampleRate * 20,
          1777
        );
        const sourceTemplate = wave.slice(0);
        const catalog = fixture.createCatalogPathFixture(policy, wave, 3);
        const context = new AudioContext({ sampleRate: profile.outputSampleRate });
        let transport = null;
        try {
          let topologyCanvas = document.createElement('canvas');
          topologyCanvas.width = 1;
          topologyCanvas.height = 1;
          let topologyGpu = topologyCanvas.getContext('webgl');
          if (!topologyGpu) throw new Error('Electron GPU topology is unavailable');
          topologyGpu.clearColor(0, 0, 0, 0);
          topologyGpu.clear(topologyGpu.COLOR_BUFFER_BIT);
          topologyGpu.getExtension('WEBGL_lose_context')?.loseContext();
          topologyGpu = null;
          topologyCanvas = null;
          await new Promise(resolve => requestAnimationFrame(() => resolve()));
          const coldBefore = await sampleProcessMemory();
          const warmTransport = new transportModule.RollingPcmTransport(context, {
            sourceReacquirer: () => sourceTemplate.slice(0)
          });
          const warmSource = sourceTemplate.slice(0);
          await warmTransport.prepare(catalog.snapshot, {
            outputSampleRate: profile.outputSampleRate,
            decoderProfile: profile.codec,
            resamplerProfile: profile.id,
            sourceOverride: { kind: 'bytes', bytes: warmSource },
            minimumHeadFrames: profile.logicalOutputFrames
          });
          if (!warmTransport.promoteReservation()) {
            throw new Error('warm-up reservation promotion failed');
          }
          await warmTransport.fillTo(profile.logicalOutputFrames * 2);
          warmTransport.releaseQueuedBuffers();
          const warmSeek = await warmTransport.seek(0, { resume: false });
          if (warmSeek?.adoptedFrame !== 0) {
            throw new Error(`warm-up seek failed: ${JSON.stringify(warmSeek)}`);
          }
          const coldPeak = await sampleProcessMemory();
          await warmTransport.dispose();
          const warmDispose = warmTransport.getDiagnosticSnapshot();
          const warmSettleStartedAt = performance.now();
          const warmSettleRemainingMs = 20000 - (performance.now() - warmSettleStartedAt);
          if (warmSettleRemainingMs > 0) {
            await new Promise(resolve => setTimeout(resolve, warmSettleRemainingMs));
          }
          const before = await sampleProcessMemory();
          transport = new transportModule.RollingPcmTransport(context, {
            sourceReacquirer: () => sourceTemplate.slice(0)
          });
          const initialSource = sourceTemplate.slice(0);
          await transport.prepare(catalog.snapshot, {
            outputSampleRate: profile.outputSampleRate,
            decoderProfile: profile.codec,
            resamplerProfile: profile.id,
            sourceOverride: { kind: 'bytes', bytes: initialSource },
            minimumHeadFrames: profile.logicalOutputFrames
          });
          if (!transport.promoteReservation()) {
            throw new Error('accelerated evidence reservation promotion failed');
          }
          const fragmentsPerTrack = transport.metadata.totalFrames / profile.logicalOutputFrames;
          const fragmentCount = 2048;
          let warmupSnapshot = null;
          let warmup = null;
          for (let fragment = 2; fragment <= fragmentCount; fragment++) {
            transport.releaseQueuedBuffers();
            const fragmentInTrack = (fragment - 1) % fragmentsPerTrack;
            if (fragmentInTrack === 0) {
              const seek = await transport.seek(0, { resume: false });
              if (seek?.adoptedFrame !== 0) {
                throw new Error(`accelerated evidence seek failed: ${JSON.stringify({
                  seek,
                  diagnostics: transport.getDiagnosticSnapshot(),
                  reservationRole: transport.reservationLedger.getRole(
                    transport.reservationOwner
                  ),
                  reservedBytes: transport.reservationLedger.totalReservedBytes()
                })}`);
              }
            } else {
              await transport.fillTo((fragmentInTrack + 1) * profile.logicalOutputFrames);
            }
            if (fragment === 1024) {
              warmupSnapshot = transport.getDiagnosticSnapshot();
              warmup = await sampleProcessMemory();
            }
          }
          const plateauSnapshot = transport.getDiagnosticSnapshot();
          const plateau = await sampleProcessMemory();
          const liveMemoryEvidence = policy.createRollingPcmLiveMemoryEvidence({
            categories: plateauSnapshot.liveMemoryCategories,
            cell: {
              host: 'electron',
              format: 'wav',
              sampleRate: profile.outputSampleRate,
              channelCount: profile.channelCount,
              lifecycle: 'foreground'
            },
            profileId: policy.DEFAULT_ROLLING_PCM_PROFILE_ID
          });
          await transport.dispose();
          const cleanupStartedAt = performance.now();
          const afterDisposeSamples = [];
          for (const targetElapsedMs of policy.ROLLING_PCM_CLEANUP_OBSERVATION_TIMES_MS) {
            const remainingMs = targetElapsedMs - (performance.now() - cleanupStartedAt);
            if (remainingMs > 0) await new Promise(resolve => setTimeout(resolve, remainingMs));
            afterDisposeSamples.push({
              ...(await sampleProcessMemory()),
              targetElapsedMs,
              observedElapsedMs: performance.now() - cleanupStartedAt
            });
          }
          return {
            userAgent: navigator.userAgent,
            fragmentCount,
            warmupSnapshot,
            plateauSnapshot,
            afterDispose: transport.getDiagnosticSnapshot(),
            liveMemoryEvidence,
            fullDecodeBaselineBytes: wave.byteLength + transport.metadata.totalFrames *
              profile.channelCount * Float32Array.BYTES_PER_ELEMENT,
            processMemory: { coldBefore, coldPeak, before, warmup, plateau, afterDisposeSamples },
            warmDispose,
            afterDisposeReachability: {
              worker: transport.worker === null,
              bus: transport.bus === null,
              sourceSnapshot: transport.sourceSnapshot === null,
              sourceReacquirer: transport.sourceReacquirer === null,
              reservationHeld: transport.reservationHeld === false,
              reservationRole: transport.reservationLedger.getRole(
                transport.reservationOwner
              ),
              queueLength: transport.queue.length
            },
            staticReferences: {
              waveBytes: wave.byteLength,
              sourceTemplateBytes: sourceTemplate.byteLength
            },
            explicitGcAvailable: typeof globalThis.gc === 'function'
          };
        } finally {
          await transport?.dispose();
          await context.close();
        }
      });
      const processMemory = result.processMemory;
      const topologyIdentity = sample => sample.entries.map(entry => [
        entry.pid,
        entry.type,
        entry.serviceName,
        entry.creationTime
      ]).sort((left, right) => left[0] - right[0]);
      const processSamples = [processMemory.before, processMemory.warmup, processMemory.plateau,
        ...processMemory.afterDisposeSamples];
      const samplesHaveRequiredProcesses = processSamples.every(sample =>
        sample.entries.some(entry => entry.type === 'Browser') &&
        sample.entries.some(entry => entry.type === 'Tab') &&
        Number.isSafeInteger(sample.totalWorkingSetBytes));
      const baselineTopology = JSON.stringify(topologyIdentity(processMemory.before));
      const topologyStable = processSamples.every(sample =>
        JSON.stringify(topologyIdentity(sample)) === baselineTopology);
      const evidenceProfile = result.liveMemoryEvidence;
      // Every process must report its own high-water mark; a sum could hide a
      // process whose peak metric is unavailable behind another's headroom.
      const peakWorkingSetTracked = [processMemory.coldPeak, processMemory.plateau].every(sample =>
        sample.entries.every(entry => entry.peakWorkingSetBytes >= entry.workingSetBytes));
      // Peak increases come from the OS high-water marks observed at the end of
      // each cycle, so they bound every moment between the baseline and the
      // plateau instead of the two sampled instants.
      const peakIncrease = Math.max(0,
        processMemory.plateau.totalPeakWorkingSetBytes - processMemory.before.totalWorkingSetBytes);
      const plateauSpread = Math.max(0,
        processMemory.plateau.totalWorkingSetBytes - processMemory.warmup.totalWorkingSetBytes);
      const cleanupObservationOveragesBytes = processMemory.afterDisposeSamples.map(sample =>
        Math.max(0, sample.totalWorkingSetBytes - processMemory.before.totalWorkingSetBytes));
      const coldStartPeakIncrease = Math.max(0,
        processMemory.coldPeak.totalPeakWorkingSetBytes -
          processMemory.coldBefore.totalWorkingSetBytes);
      const processDeltas = sample => ({
        targetElapsedMs: sample.targetElapsedMs ?? null,
        totalWorkingSetBytes: sample.totalWorkingSetBytes -
          processMemory.before.totalWorkingSetBytes,
        rendererHeap: sample.rendererHeap === null || processMemory.before.rendererHeap === null
          ? null
          : sample.rendererHeap.usedJSHeapSize - processMemory.before.rendererHeap.usedJSHeapSize,
        entries: sample.entries.map(entry => {
          const baseline = processMemory.before.entries.find(candidate =>
            candidate.pid === entry.pid && candidate.type === entry.type &&
            candidate.serviceName === entry.serviceName &&
            candidate.creationTime === entry.creationTime);
          return {
            pid: entry.pid,
            type: entry.type,
            workingSetBytes: baseline ? entry.workingSetBytes - baseline.workingSetBytes : null,
            privateBytes: baseline ? entry.privateBytes - baseline.privateBytes : null
          };
        })
      });
      t.diagnostic(`electron-rolling-process-memory ${JSON.stringify({
        coldStartPeakIncrease,
        peakIncrease,
        plateauSpread,
        cleanupObservationOveragesBytes,
        processDeltas: {
          warmup: processDeltas(processMemory.warmup),
          plateau: processDeltas(processMemory.plateau),
          cleanup: processMemory.afterDisposeSamples.map(processDeltas)
        },
        liveMemoryCategories: result.liveMemoryEvidence.categories,
        warmDispose: result.warmDispose,
        warmTransport: result.warmupSnapshot,
        plateauTransport: result.plateauSnapshot,
        transportAfterDispose: result.afterDispose,
        afterDisposeReachability: result.afterDisposeReachability,
        staticReferences: result.staticReferences,
        samplesHaveRequiredProcesses,
        topologyStable,
        peakWorkingSetTracked,
        explicitGcAvailable: result.explicitGcAvailable
      })}`);
      assert.match(result.userAgent, /Electron\/44\./);
      assert.equal(result.fragmentCount, 2048);
      assert.equal(result.warmupSnapshot.maxLivePcmBytes,
        result.plateauSnapshot.maxLivePcmBytes);
      assert.equal(result.liveMemoryEvidence.withinCaps, true);
      assert.ok(result.liveMemoryEvidence.totalBytes < result.fullDecodeBaselineBytes);
      assertTransportResourcesReleased(result.warmDispose, 'warmTransport');
      assertTransportResourcesReleased(result.afterDispose, 'memoryEvidence');
      assert.equal(Object.values(result.afterDispose.liveMemoryCategories).every(value => value === 0),
        true);
      assert.equal(samplesHaveRequiredProcesses, true);
      assert.equal(topologyStable, true);
      assert.equal(peakWorkingSetTracked, true);
      assert.deepEqual(result.afterDisposeReachability, {
        worker: true,
        bus: true,
        sourceSnapshot: true,
        sourceReacquirer: true,
        reservationHeld: true,
        reservationRole: null,
        queueLength: 0
      });
      assert.ok(peakIncrease <= evidenceProfile.aggregateByteCap,
        `Electron process peak increase ${peakIncrease}`);
      assert.ok(coldStartPeakIncrease <= evidenceProfile.aggregateByteCap,
        `Electron cold-start peak increase ${coldStartPeakIncrease}`);
      assert.ok(plateauSpread <= evidenceProfile.categoryCaps.queuedAudioBufferBytes,
        `Electron process plateau growth ${plateauSpread}`);
      assert.deepEqual(processMemory.afterDisposeSamples.map(sample => sample.targetElapsedMs),
        [1000, 5000, 10000, 15000, 20000]);
      assert.ok(cleanupObservationOveragesBytes.some(overage =>
        overage <= evidenceProfile.categoryCaps.queuedAudioBufferBytes),
      `Electron process baseline return ${JSON.stringify(cleanupObservationOveragesBytes)}`);
    } finally {
      await runtime?.close();
      await fixtureServer.close();
    }
  });

test('Electron rolling deactivation freezes paused position and ignores a late Worker event',
  { timeout: 60_000 }, async () => {
    const fixtureServer = await startWorkerServer();
    let runtime = null;
    try {
      runtime = await startElectronPage(fixtureServer.baseURL);
      await runtime.application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.show();
        window.focus();
      });
      await runtime.page.waitForFunction(() => document.visibilityState === 'visible');
      const setup = await runtime.page.evaluate(async () => {
        const [core, policy, protocol, transportModule, fixture] = await Promise.all([
          import('/js/ui/audio-player/rolling-pcm-core.js'),
          import('/js/ui/audio-player/rolling-pcm-policy.js'),
          import('/js/ui/audio-player/rolling-pcm-protocol.js'),
          import('/js/ui/audio-player/rolling-pcm-transport.js'),
          import('/tests/rolling-pcm-electron-fixture.mjs')
        ]);
        const profile = core.PCM16_STEREO_44100_TO_96000_PROFILE;
        const wave = fixture.createStrictPcm16StereoWave(profile, 88200, 1877);
        const catalog = fixture.createCatalogPathFixture(policy, wave, 3);
        const ledger = new policy.RollingPcmAdmissionLedger();
        const events = [];
        let endedCount = 0;
        let failureCount = 0;
        window.addEventListener('visibilitychange', () => events.push(document.visibilityState));
        const context = new AudioContext({ sampleRate: profile.outputSampleRate });
        const prepareOptions = () => ({
          outputSampleRate: profile.outputSampleRate,
          decoderProfile: profile.codec,
          resamplerProfile: profile.id,
          sourceOverride: { kind: 'bytes', bytes: wave.slice(0) },
          minimumHeadFrames: profile.logicalOutputFrames
        });
        const current = new transportModule.RollingPcmTransport(context, {
          reservationLedger: ledger,
          onEnded: () => { endedCount++; },
          onFailure: () => { failureCount++; }
        });
        await current.prepare(catalog.snapshot, prepareOptions());
        if (!current.promoteReservation()) throw new Error('current reservation promotion failed');
        const next = new transportModule.RollingPcmTransport(context, {
          reservationLedger: ledger,
          reservationRole: 'next',
          onFailure: () => { failureCount++; }
        });
        await next.prepare(catalog.snapshot, prepareOptions());
        current.connect(context.destination);
        await context.resume();
        const activated = current.activate({ when: context.currentTime + 0.05 });
        await new Promise(resolve => setTimeout(resolve, 250));
        window.__rollingLifecycleFixture = {
          context,
          current,
          next,
          protocol,
          events,
          getEndedCount: () => endedCount,
          getFailureCount: () => failureCount
        };
        return {
          activated,
          visibilityState: document.visibilityState,
          contextState: context.state,
          positionFrame: current.getPositionFrame(),
          nextPrepared: next.prepared
        };
      });
      assert.equal(setup.activated, true);
      assert.equal(setup.visibilityState, 'visible');
      assert.equal(setup.contextState, 'running');
      assert.ok(setup.positionFrame > 0);
      assert.equal(setup.nextPrepared, true);

      await runtime.application.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].minimize();
      });
      await new Promise(resolve => setTimeout(resolve, 150));
      const nativeDeactivation = await runtime.application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return {
          minimized: window.isMinimized(),
          visible: window.isVisible(),
          focused: window.isFocused()
        };
      });
      const result = await runtime.page.evaluate(async () => {
        const fixture = window.__rollingLifecycleFixture;
        const { context, current, next, protocol, events } = fixture;
        const hiddenPosition = current.getPositionFrame();
        const playingWhileHidden = current.playing;
        const paused = current.pause();
        const frozenPosition = current.getPositionFrame();
        await context.suspend();
        const explicitlySuspendedState = context.state;
        const staleBefore = current.getDiagnosticSnapshot().staleMessages;
        current.handleWorkerMessage(protocol.createRollingPcmEnvelope(
          protocol.RollingPcmEvent.QUEUE_STATE,
          { ...current.ids(), generation: current.generation - 1 },
          { sentFrame: current.lastReceivedFrame, ended: current.decoderEnded }
        ));
        const staleAfter = current.getDiagnosticSnapshot().staleMessages;
        await context.resume();
        await new Promise(resolve => setTimeout(resolve, 150));
        const positionAfterResume = current.getPositionFrame();
        const playingAfterResume = current.playing;
        const endedAfterLateEvent = fixture.getEndedCount();
        const failuresAfterLateEvent = fixture.getFailureCount();
        const nextBeforeDispose = next.getDiagnosticSnapshot();
        await current.stop();
        await next.dispose();
        const afterDispose = {
          current: current.getDiagnosticSnapshot(),
          next: next.getDiagnosticSnapshot()
        };
        await context.close();
        delete window.__rollingLifecycleFixture;
        return {
          visibilityState: document.visibilityState,
          visibilityEvents: events,
          hiddenPosition,
          playingWhileHidden,
          paused,
          frozenPosition,
          explicitlySuspendedState,
          staleBefore,
          staleAfter,
          positionAfterResume,
          playingAfterResume,
          endedAfterLateEvent,
          failuresAfterLateEvent,
          nextBeforeDispose,
          afterDispose
        };
      });

      assert.equal(nativeDeactivation.minimized, true);
      assert.equal(nativeDeactivation.visible, false);
      assert.ok(result.hiddenPosition >= setup.positionFrame);
      assert.equal(result.playingWhileHidden, true);
      assert.equal(result.paused, true);
      assert.equal(result.explicitlySuspendedState, 'suspended');
      assert.equal(result.staleAfter, result.staleBefore + 1);
      assert.equal(result.positionAfterResume, result.frozenPosition);
      assert.equal(result.playingAfterResume, false);
      assert.equal(result.endedAfterLateEvent, 0);
      assert.equal(result.failuresAfterLateEvent, 0);
      assert.equal(result.nextBeforeDispose.prepared, true);
      assert.equal(result.afterDispose.current.disposeCount, 1);
      assert.equal(result.afterDispose.next.disposeCount, 1);
      for (const [label, snapshot] of Object.entries(result.afterDispose)) {
        assertTransportResourcesReleased(snapshot, label);
      }
    } finally {
      await runtime?.close();
      await fixtureServer.close();
    }
  });
