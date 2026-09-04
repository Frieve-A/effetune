import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const repoRoot = path.resolve('.');

async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Rolling PCM endurance</title>');
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
        'Content-Type': path.extname(filePath) === '.mjs' || path.extname(filePath) === '.js'
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

test('accelerated rolling soak stays free of queue-exhaustion underruns under deterministic decoder jitter and emits a capability report reflecting the enabled production cell',
  { timeout: 120_000 }, async t => {
    const fixtureServer = await startFixtureServer();
    let browser = null;
    let page = null;
    let cdp = null;
    try {
      browser = await chromium.launch({ headless: true });
      page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(fixtureServer.baseURL);
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const result = await page.evaluate(async () => {
        const [{ RollingPcmTransport }, protocol, policy] = await Promise.all([
          import('/js/ui/audio-player/rolling-pcm-transport.js'),
          import('/js/ui/audio-player/rolling-pcm-protocol.js'),
          import('/js/ui/audio-player/rolling-pcm-policy.js')
        ]);
        const slabFrames = 128;
        const slabCount = 2048;
        const totalFrames = slabFrames * slabCount;
        // Plan 13.2 deterministic decoder jitter: a fixed-seed LCG decides, slab by
        // slab, whether the fake decoder emits immediately or only after a
        // setTimeout delay of 1..DECODER_JITTER_MAX_DELAY_MS milliseconds. The same
        // seed is used for every profile, so the schedule is reproducible run to run
        // and identical across profiles. Sizing note: under the 4x CPU throttle every
        // timer takes about 4x wall time, and the transport's 15 s worker-response
        // wait must still cover the largest head fill (2048 slabs for resilience).
        const DECODER_JITTER_SEED = 0x5eed2026;
        const DECODER_JITTER_MAX_DELAY_MS = 24;
        const DECODER_JITTER_DELAYED_FRACTION = 1 / 16;
        const FAKE_SOURCE_PLAYBACK_MS = 1;
        function createDecoderJitterSchedule(seed) {
          let state = seed >>> 0;
          const stats = {
            seed: state,
            maxDelayMs: DECODER_JITTER_MAX_DELAY_MS,
            immediateSlabs: 0,
            delayedSlabs: 0,
            observedMaxDelayMs: 0,
            totalDelayMs: 0
          };
          return {
            stats,
            nextDelayMs() {
              state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
              const unit = state / 0x100000000;
              if (unit >= DECODER_JITTER_DELAYED_FRACTION) {
                stats.immediateSlabs++;
                return 0;
              }
              const delayMs = 1 + Math.floor(
                (unit / DECODER_JITTER_DELAYED_FRACTION) * DECODER_JITTER_MAX_DELAY_MS
              );
              stats.delayedSlabs++;
              stats.observedMaxDelayMs = Math.max(stats.observedMaxDelayMs, delayMs);
              stats.totalDelayMs += delayMs;
              return delayMs;
            }
          };
        }

        class FakeNode {
          connect() { return this; }
          disconnect() {}
        }

        class FakeSource extends FakeNode {
          constructor(context) {
            super();
            this.context = context;
            this.onended = null;
            this.buffer = null;
            this.stopped = false;
          }
          start(when = this.context.currentTime, offset = 0) {
            // The fake clock only advances to a source's end when that source
            // ends, so a start is never behind the audible clock here: the
            // transport's late-schedule underrun path is unreachable by
            // construction, and this soak exercises only the queue-exhaustion
            // underrun (a source ending with nothing queued behind it).
            this.context.clock.sources++;
            const endTime = when + Math.max(0, (this.buffer?.duration ?? 0) - offset);
            // Sources take wall-clock time to end so decoder jitter is absorbed by the
            // transport queue instead of racing a microtask-speed consumer.
            setTimeout(() => {
              if (this.stopped) return;
              // Audible time advances deterministically to this source's end before
              // its ended event releases the next schedule.
              this.context.currentTime = Math.max(this.context.currentTime, endTime);
              this.onended?.();
            }, FAKE_SOURCE_PLAYBACK_MS);
          }
          stop() { this.stopped = true; }
        }

        class FakeContext {
          constructor() {
            this.sampleRate = 48000;
            this.currentTime = 0;
            this.clock = { sources: 0 };
          }
          createGain() {
            const node = new FakeNode();
            node.gain = { value: 1 };
            return node;
          }
          createBuffer(channelCount, frameCount, sampleRate) {
            const planes = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
            return {
              duration: frameCount / sampleRate,
              copyToChannel(source, channel) { planes[channel].set(source); }
            };
          }
          createBufferSource() { return new FakeSource(this); }
        }

        class DelayedWorker {
          constructor(jitter) {
            this.jitter = jitter;
            this.onmessage = null;
            this.onerror = null;
            this.sentFrame = 0;
            this.nextSlabId = 1;
            this.outstandingSlabId = null;
            this.targetFrame = 0;
            this.fillRequest = null;
            this.activeIds = null;
            this.segmentEnded = false;
            this.terminated = false;
          }
          postMessage(message) {
            if (message.type === protocol.RollingPcmCommand.OPEN) {
              this.sentFrame = 0;
              this.nextSlabId = 1;
              this.outstandingSlabId = null;
              this.targetFrame = 0;
              this.fillRequest = null;
              this.activeIds = {
                transportId: message.transportId,
                generation: message.generation,
                segmentId: message.segmentId
              };
              this.segmentEnded = false;
              queueMicrotask(() => this.emit(protocol.RollingPcmEvent.READY, message, {
                sampleRate: 48000,
                channelCount: 2,
                durationSec: totalFrames / 48000,
                totalFrames,
                containerMimeType: 'audio/wav',
                codec: 'pcm-s16',
                decoderConfigCodec: 'pcm-s16',
                decoderConfigVerified: true
              }));
              return;
            }
            if (message.type === protocol.RollingPcmCommand.FILL) {
              this.fillRequest = message;
              this.targetFrame = message.targetFrame;
              queueMicrotask(() => this.emitAvailableSlab());
              return;
            }
            if (message.type === protocol.RollingPcmCommand.RECYCLE) {
              if (this.matchesActiveGeneration(message) &&
                  message.slabId === this.outstandingSlabId) {
                this.outstandingSlabId = null;
                queueMicrotask(() => this.emitAvailableSlab());
              }
              return;
            }
            if (message.type === protocol.RollingPcmCommand.DISPOSE) {
              queueMicrotask(() => this.emit(protocol.RollingPcmEvent.DISPOSED, message));
            }
          }
          matchesActiveGeneration(message) {
            return message.transportId === this.activeIds?.transportId &&
              message.generation === this.activeIds?.generation &&
              message.segmentId === this.activeIds?.segmentId;
          }
          emitAvailableSlab() {
            if (!this.fillRequest || this.outstandingSlabId !== null) return;
            if (this.sentFrame < this.targetFrame) {
              const frameCount = Math.min(slabFrames, this.targetFrame - this.sentFrame);
              const startFrame = this.sentFrame;
              const slabId = this.nextSlabId++;
              this.sentFrame += frameCount;
              this.outstandingSlabId = slabId;
              const request = this.fillRequest;
              const emitSlab = () => {
                if (this.terminated) return;
                this.emit(protocol.RollingPcmEvent.SLAB, request, {
                  slabId,
                  startFrame,
                  frameCount,
                  channelCount: 2,
                  planes: [
                    new Float32Array(frameCount).buffer,
                    new Float32Array(frameCount).buffer
                  ]
                });
              };
              const delayMs = this.jitter.nextDelayMs();
              if (delayMs === 0) emitSlab();
              else setTimeout(emitSlab, delayMs);
              return;
            }
            if (this.sentFrame === totalFrames && !this.segmentEnded) {
              this.segmentEnded = true;
              this.emit(protocol.RollingPcmEvent.SEGMENT_END, this.fillRequest, { totalFrames });
              return;
            }
            this.emit(protocol.RollingPcmEvent.QUEUE_STATE, this.fillRequest, {
              decodedFrame: this.sentFrame,
              sentFrame: this.sentFrame,
              ended: false
            });
          }
          emit(type, request, payload = {}) {
            this.onmessage?.({
              data: protocol.createRollingPcmEnvelope(type, request, payload)
            });
          }
          terminate() { this.terminated = true; }
        }

        async function measureProfile(profileId) {
          const jitter = createDecoderJitterSchedule(DECODER_JITTER_SEED);
          const worker = new DelayedWorker(jitter);
          let ended = 0;
          let resolveEnded;
          const endedPromise = new Promise(resolve => { resolveEnded = resolve; });
          const context = new FakeContext();
          const transport = new RollingPcmTransport(context, {
            profileId,
            workerFactory: () => worker,
            onEnded: () => {
              ended++;
              resolveEnded();
            }
          });
          await transport.prepare({
            sourceKind: 'bytes',
            bytes: new Uint8Array([1, 2, 3]),
            byteLength: 3,
            format: 'wav'
          });
          transport.activate({ when: 0, frame: 0 });
          let timeoutId;
          try {
            await Promise.race([
              endedPromise,
              new Promise((_, reject) => {
                timeoutId = setTimeout(
                  () => reject(new Error(`${profileId} soak timed out`)),
                  15000
                );
              })
            ]);
          } finally {
            clearTimeout(timeoutId);
          }
          if (ended !== 1) throw new Error(`${profileId} soak did not finish`);
          const peak = transport.getDiagnosticSnapshot();
          await transport.dispose();
          return {
            profileId,
            continuityPassed: peak.underruns === 0,
            resourceCapsPassed: peak.maxLiveSourceNodes <= transport.profile.sourceNodeCap &&
              peak.maxLivePcmBytes <= transport.profile.currentPcmByteCap,
            // The accelerated fake clock proves live-resource caps and cleanup,
            // but it is not a browser resident-memory warm-up series.
            plateauPassed: false,
            residentPeakBytes: peak.maxLivePcmBytes,
            baselineResidentPeakBytes: totalFrames * 2 * Float32Array.BYTES_PER_ELEMENT,
            liveNodePeak: peak.maxLiveSourceNodes,
            slabCount,
            peak,
            final: transport.getDiagnosticSnapshot(),
            terminated: worker.terminated,
            decoderJitter: { ...jitter.stats },
            clock: { ...context.clock }
          };
        }

        const measurements = [];
        for (const profile of policy.ROLLING_PCM_CANDIDATE_PROFILES) {
          measurements.push(await measureProfile(profile.id));
        }
        const selected = policy.selectMemoryProfile(measurements);
        const lifecycleEvents = [];
        for (const name of ['visibilitychange', 'pagehide', 'pageshow', 'freeze', 'resume']) {
          const target = name === 'visibilitychange' ? document : window;
          target.addEventListener(name, () => lifecycleEvents.push(name), { once: true });
          target.dispatchEvent(new Event(name));
        }
        const scenarioNames = [
          'foreground',
          'background',
          'pagehide-pageshow',
          'context-suspend-resume',
          'producer-only-freeze',
          'output-graph-rebuild',
          'mobile-viewport'
        ];
        const snapshot = {
          sourceKind: 'bytes',
          bytes: new Uint8Array([1]),
          byteLength: 1024,
          format: 'wav',
          mediaSource: 'large.wav',
          legacyDecision: { mode: 'buffer', allowMediaFallback: true, reason: 'legacy' }
        };
        const metadata = { durationSec: 600, sampleRate: 48000, channelCount: 2 };
        const scenarios = scenarioNames.map(lifecycle => ({
          lifecycle,
          decision: policy.selectPlaybackBackend({
            snapshot,
            metadata,
            audioContext: { sampleRate: lifecycle === 'output-graph-rebuild' ? 96000 : 48000 },
            policyMode: policy.RollingPolicyMode.LIMITED_ROLLING,
            enabledMatrix: policy.PRODUCTION_ROLLING_ENABLED_MATRIX,
            capability: {
              host: 'chromium',
              lifecycle,
              workerAvailable: true,
              audioDecoderAvailable: true
            }
          })
        }));
        const maxResources = measurements.reduce((maximum, measurement) => ({
          maxLivePcmBytes: Math.max(maximum.maxLivePcmBytes, measurement.peak.maxLivePcmBytes),
          maxLiveSourceNodes: Math.max(maximum.maxLiveSourceNodes, measurement.peak.maxLiveSourceNodes),
          underruns: maximum.underruns + measurement.peak.underruns,
          liveWorkers: Math.max(maximum.liveWorkers, measurement.peak.liveWorkers),
          liveHandlers: Math.max(maximum.liveHandlers, measurement.peak.liveHandlers),
          liveTimers: Math.max(maximum.liveTimers, measurement.peak.liveTimers),
          liveObjectUrls: Math.max(maximum.liveObjectUrls, measurement.peak.liveObjectUrls)
        }), {
          maxLivePcmBytes: 0,
          maxLiveSourceNodes: 0,
          underruns: 0,
          liveWorkers: 0,
          liveHandlers: 0,
          liveTimers: 0,
          liveObjectUrls: 0
        });
        const missingCounters = [...policy.ROLLING_PCM_LIVE_MEMORY_CATEGORIES];
        const report = policy.createRollingPcmCapabilityReport({
          productionEvidenceRecord: policy.PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD,
          cells: [{
            host: 'chromium',
            format: 'wav',
            sampleRate: 48000,
            channelCount: 2,
            lifecycle: 'foreground',
            selectedProfileId: selected?.profileId ?? null,
            enabled: false,
            reason: 'required-live-memory-counters-unavailable',
            liveResources: {
              ...maxResources,
              requiredCountersAvailable: false,
              missingCounters
            }
          }],
          processMemory: {
            available: false,
            metric: null,
            reason: 'portable Playwright does not expose renderer/audio resident memory'
          }
        });
        return { measurements, selected, lifecycleEvents, scenarios, report };
      });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

      assert.equal(result.measurements.length, 3);
      assert.equal(result.selected, null);
      for (const measurement of result.measurements) {
        assert.equal(measurement.slabCount, 2048);
        assert.equal(measurement.continuityPassed, true, measurement.profileId);
        assert.equal(measurement.resourceCapsPassed, true, measurement.profileId);
        assert.equal(measurement.peak.underruns, 0, measurement.profileId);
        // Sanity only: a zero underrun count says something just when sources were
        // actually scheduled through the fake clock.
        assert.ok(measurement.clock.sources > 0, measurement.profileId);
        assert.equal(measurement.final.liveAudioBuffers, 0, measurement.profileId);
        assert.equal(measurement.final.liveSourceNodes, 0, measurement.profileId);
        assert.equal(measurement.final.liveWorkers, 0, measurement.profileId);
        assert.equal(measurement.final.liveHandlers, 0, measurement.profileId);
        assert.equal(measurement.final.liveTimers, 0, measurement.profileId);
        assert.equal(measurement.final.liveObjectUrls, 0, measurement.profileId);
        assert.equal(measurement.terminated, true, measurement.profileId);
        assert.equal(
          measurement.decoderJitter.immediateSlabs + measurement.decoderJitter.delayedSlabs,
          2048,
          measurement.profileId
        );
        assert.ok(measurement.decoderJitter.delayedSlabs > 0, measurement.profileId);
        assert.ok(measurement.decoderJitter.observedMaxDelayMs >= 1, measurement.profileId);
        assert.ok(measurement.decoderJitter.observedMaxDelayMs <= 24, measurement.profileId);
        // Same seed for every profile: the schedule must be reproducible, not random.
        assert.deepEqual(measurement.decoderJitter, result.measurements[0].decoderJitter,
          measurement.profileId);
      }
      t.diagnostic(`rolling-pcm-decoder-jitter ${JSON.stringify(result.measurements[0].decoderJitter)}`);
      assert.deepEqual(result.lifecycleEvents,
        ['visibilitychange', 'pagehide', 'pageshow', 'freeze', 'resume']);
      for (const scenario of result.scenarios) {
        assert.notEqual(scenario.decision.mode, 'rolling', scenario.lifecycle);
        assert.equal(scenario.decision.mode, 'media', scenario.lifecycle);
      }
      assert.equal(result.report.productionMode, 'limitedRolling');
      assert.equal(result.report.selectedProfileId, 'memory-first');
      assert.equal(result.report.enabledMatrix.length, 1);
      assert.equal(result.report.enabledMatrix[0].host, 'electron');
      assert.equal(result.report.enabledMatrix[0].lifecycle, 'foreground');
      assert.equal(result.report.cells[0].enabled, false);
      assert.equal(result.report.processMemory.available, false);
      assert.equal(result.report.cells[0].reason, 'required-live-memory-counters-unavailable');
      assert.equal(result.report.cells[0].liveResources.requiredCountersAvailable, false);
      assert.equal(result.report.cells[0].liveResources.missingCounters.length, 11);
      t.diagnostic(`rolling-pcm-report ${JSON.stringify(result.report)}`);
    } finally {
      if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
      await page?.close();
      await browser?.close();
      await fixtureServer.close();
    }
  });
