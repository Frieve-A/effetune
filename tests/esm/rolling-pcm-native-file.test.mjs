import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeFilePlayback } from '../../js/native/file-playback.js';
import { AudioContextManager } from '../../js/ui/audio-player/audio-context-manager.js';
import { normalizePlaybackSourceDescriptor } from '../../js/ui/audio-player/playback-source-policy.js';
import { evaluateRollingEligibility, RollingPolicyMode } from '../../js/ui/audio-player/rolling-pcm-policy.js';

function harness() {
  const messages = [];
  const waiters = [];
  const manager = {
    filePort: { postMessage: message => messages.push(message) },
    audioContext: { sampleRate: 48000 },
    _getDeviceLatencyFrames: () => 100,
    getTotalPipelineLatencySamples: () => 28,
    waitFor: (type, accept) => new Promise(resolve => waiters.push({ type, accept, resolve }))
  };
  const file = new NativeFilePlayback(manager);
  const reply = detail => {
    const waiter = waiters.shift();
    assert.equal(waiter.type, 'fileCancelNextResult');
    assert.ok(waiter.accept(detail));
    waiter.resolve({ detail });
  };
  const clock = fields => file.update({ fileGeneration: 1, fileTrack: 1, fileReadFrame: 0,
    fileRunning: false, fileWrittenFrames: 0, fileQueuedFrames: 0, pipelineFrame: 0, time: performance.now(), ...fields });
  return { file, manager, messages, reply, clock };
}

function track() {
  return { metadata: { sampleRate: 48000, channelCount: 2, totalFrames: 96000 },
    scheduleAvailable() {}, publishEnded() { this.ended = true; } };
}

test('native files respect the global byte window and 8192-frame planar packets', () => {
  const { file, messages, clock } = harness();
  const first = track();
  const entry = file.start(first, 0, { gain: .5 });
  const record = { startFrame: 0, frameCount: 48000, planes: [new Float32Array(48000).fill(.25).buffer,
    new Float32Array(48000).fill(-.5).buffer] };
  let offset = 0;
  for (let packet = 0; packet < 4; ++packet) offset += file.sendPcm(entry, record, offset);
  assert.equal(offset, 32768);
  assert.equal(file.pendingBytes, 256 * 1024);
  assert.equal(file.sendPcm(entry, record, offset), 0);
  assert.deepEqual(messages.map(message => message.type), ['fileStart', 'feed', 'feed', 'feed', 'feed']);
  assert.ok(messages.slice(1).every(message => message.frames === 8192 && message.stream === 'file'));
  const pcm = new Float32Array(messages.at(-1).attachment);
  assert.equal(pcm[0], .25);
  assert.equal(pcm[8192], -.5);
  clock({ fileWrittenFrames: 32768, fileQueuedFrames: 95999 });
  assert.equal(file.sendPcm(entry, record, offset), 1);
  assert.equal(file.sendPcm(entry, record, offset + 1), 0);
});

test('native lookahead of a six-channel 384 kHz file stays within half of the shared ring', () => {
  const { file, clock } = harness();
  const wide = { metadata: { sampleRate: 384000, channelCount: 6, totalFrames: 384000 },
    scheduleAvailable() {}, publishEnded() {} };
  const entry = file.start(wide, 0, { gain: 1 });
  const record = { startFrame: 0, frameCount: 16, planes: Array.from({ length: 6 }, () => new Float32Array(16).buffer) };
  clock({ fileQueuedFrames: 255999 });
  assert.equal(file.sendPcm(entry, record, 0), 1);
  assert.equal(file.sendPcm(entry, record, 1), 0);
});

test('engine cancellation preserves a started next track and the visible transition waits for device delay', async () => {
  const { file, messages, reply, clock } = harness();
  const first = track(), second = track(), third = track();
  const initial = file.start(first, 0, { gain: 1 });
  const cancelled = file.start(second, 0, { nextAfter: first, gain: 1 });
  const operation = file.cancel(cancelled);
  reply({ generation: 1, track: 2, result: 'cancelled' });
  assert.equal(await operation, 'cancelled');
  assert.equal(file.current, initial);
  const next = file.start(third, 0, { nextAfter: first, gain: .5 });
  file.reserveNext({ generation: 1, track: 3, accepted: true });
  const started = file.cancel(next);
  reply({ generation: 1, track: 3, result: 'already-playing' });
  assert.equal(await started, 'already-playing');
  file.ended({ generation: 1, track: 1, pipelineFrame: 96000 });
  clock({ fileTrack: 3, pipelineFrame: 96100, fileReadFrame: 100 });
  assert.equal(first.ended, undefined);
  assert.equal(file.position(initial), 96000);
  clock({ fileTrack: 3, pipelineFrame: 96128, fileReadFrame: 128 });
  assert.equal(first.ended, true);
  assert.equal(file.current, next);
  assert.equal(file.position(next), 128);
  assert.deepEqual(messages.map(message => message.type), ['fileStart', 'fileNext', 'fileCancelNext', 'fileNext', 'fileCancelNext']);
});

function coordinatorHarness() {
  const native = harness();
  const context = Object.assign(native.manager.audioContext, {
    currentTime: 0, createGain: () => ({ gain: {} }), createBuffer() {}, createBufferSource() {}
  });
  native.manager.filePlayback = native.file;
  const state = { playbackSpeed: 1, playbackMode: 'rollingPcm', isPlaying: true };
  const disposed = [];
  const commits = [];
  const plan = {};
  const manager = Object.assign(Object.create(AudioContextManager.prototype), {
    audioManager: native.manager,
    audioPlayer: {
      audioContext: context,
      audioElement: {},
      playbackManager: {
        isPlannedAutomaticMoveCurrent: candidate => candidate === plan,
        commitPlannedAutomaticMove: candidate => { commits.push(candidate); return true; }
      }
    },
    getCurrentState: () => state,
    videoPresentation: {},
    rollingTransports: new Set(),
    sourceGenerationSequence: 0,
    nextBufferRequestToken: 0,
    privatePipelineSourceGates: new WeakMap(),
    preparePlaybackSource() {},
    connectPrivatePipelineSource: () => true,
    setPrivatePipelineSourceMuted: () => true,
    ensurePipelineSourceConnected: () => true,
    preparePlayerSourceOwnership: () => ({ useInputWithPlayer: true }),
    getPipelineSourceNode: source => source,
    applyNativeFileGain() {},
    disposeRollingTransport: transport => { disposed.push(transport); return Promise.resolve(); },
    setupBufferMonitoring() {},
    loadMetadata() {},
    prepareNextTrackBufferWithRepeatMode() {}
  });
  const first = manager.createRollingPcmTransport('current', null, null, 2, true);
  const next = manager.createRollingPcmTransport('next', null, null, 2, true);
  for (const transport of [first, next]) {
    transport.metadata = { sampleRate: 48000, channelCount: 2, durationSec: 1, totalFrames: 48000 };
    transport.prepared = true;
  }
  manager.rollingTransport = first;
  assert.ok(first.activate());
  const prepared = { rollingTransport: next, automaticMovePlan: plan };
  manager.nextBuffer = manager.nextRollingTransport = prepared;
  next.canPromoteReservation = () => true;
  next.promoteReservation = () => true;
  assert.ok(manager.schedulePreparedRollingTransition(prepared));
  return { ...native, manager, first, next, prepared, plan, commits, disposed };
}

test('a next reservation refused after native EOF retains prepared PCM for a fresh start', () => {
  const { file, manager, first, next, prepared, messages, clock, commits, disposed } = coordinatorHarness();
  const held = { startFrame: 0, frameCount: 16, sent: 0,
    planes: Array.from({ length: 2 }, () => new Float32Array(16).buffer) };
  next.queue.push(held);
  file.end(first.nativeFileEntry, first.metadata.totalFrames);
  file.ended({ generation: 1, track: 1, pipelineFrame: 48000 });
  clock({ pipelineFrame: 48128 });
  assert.equal(first.endPublished, false);
  assert.equal(held.sent, 0);
  assert.ok(!messages.some(message => message.type === 'feed'));
  file.reserveNext({ generation: 1, track: 2, accepted: false });
  assert.equal(manager.scheduledRollingTransition, null);
  assert.equal(manager.nextBuffer, prepared);
  assert.equal(next.nativeFileEntry, null);
  assert.equal(next.playing, false);
  assert.deepEqual(commits, []);
  assert.deepEqual(disposed, []);
  manager.transitionPreparedAutomaticMove = candidate => {
    assert.equal(candidate, prepared);
    assert.ok(next.activate());
  };
  clock({ pipelineFrame: 48129 });
  assert.equal(first.endPublished, true);
  assert.equal(file.current?.transport, next);
  assert.equal(held.sent, 16);
  assert.deepEqual(messages.slice(-2).map(({ type, generation, track }) =>
    [type, generation, track]), [['fileStart', 2, 1], ['feed', 2, 1]]);
});

for (const result of ['cancelled', 'already-playing']) {
  test(`the playback coordinator waits for native cancellation result ${result}`, async () => {
    const { file, manager, first, next, prepared, plan, commits, disposed, reply, clock, messages } =
      coordinatorHarness();
    file.reserveNext({ generation: 1, track: 2, accepted: true });
    const cancellation = manager.clearNextTrackBuffer();
    assert.equal(manager.nextBuffer, prepared);
    assert.deepEqual(disposed, []);
    assert.deepEqual(messages.map(message => message.type), ['fileStart', 'fileNext', 'fileCancelNext']);
    if (result === 'already-playing') {
      file.ended({ generation: 1, track: 1, pipelineFrame: 48000 });
      clock({ fileTrack: 2, fileReadFrame: 128, pipelineFrame: 48128 });
      assert.equal(manager.rollingTransport, first);
      assert.deepEqual(commits, []);
    }
    reply({ generation: 1, track: 2, result });
    await cancellation;
    if (result === 'already-playing') {
      assert.equal(file.next?.transport, next);
      assert.equal(manager.nextBuffer, prepared);
      clock({ fileTrack: 2, fileReadFrame: 129, pipelineFrame: 48129 });
      assert.deepEqual(commits, [plan]);
      assert.deepEqual(disposed, [first]);
      assert.equal(manager.rollingTransport, next);
      assert.equal(file.current?.transport, next);
    } else {
      assert.equal(file.next, null);
      assert.deepEqual(commits, []);
      assert.deepEqual(disposed, [next]);
      assert.equal(file.current?.transport, first);
    }
    assert.equal(manager.nextBuffer, null);
    assert.equal(manager.scheduledRollingTransition, null);
    assert.ok(!messages.some(message => message.type === 'fileFlush'));
  });
}

test('native EOF cannot promote a rejected reservation while its cancellation is pending', async () => {
  const { file, manager, first, next, commits, disposed, reply, clock } = coordinatorHarness();
  const cancellation = manager.clearNextTrackBuffer();
  file.ended({ generation: 1, track: 1, pipelineFrame: 48000 });
  file.reserveNext({ generation: 1, track: 2, accepted: false });
  clock({ pipelineFrame: 48128 });
  assert.equal(first.endPublished, false);
  assert.deepEqual(commits, []);
  reply({ generation: 1, track: 2, result: 'cancelled' });
  await cancellation;
  assert.deepEqual(disposed, [next]);
  assert.equal(manager.scheduledRollingTransition, null);
  clock({ pipelineFrame: 48129 });
  assert.equal(first.endPublished, true);
  assert.deepEqual(commits, []);
});

test('retry after active file decode failure keeps the same track on the media path', async () => {
  const originalWorker = globalThis.Worker;
  globalThis.Worker = class {};
  try {
    const { manager, first } = coordinatorHarness();
    const track = { name: 'retry.wav', file: new Blob(['wave'], { type: 'audio/wav' }) };
    const descriptor = normalizePlaybackSourceDescriptor(track);
    manager.canonicalRollingSourceSnapshots = new Map();
    manager.rollingPolicyMode = RollingPolicyMode.LIMITED_ROLLING;
    manager.isGaplessPlaybackEnabled = () => true;
    assert.equal(manager.createPlaybackDecisionRecord(track, descriptor).directFile, true);
    manager.rollingLegacyFallbackLock = true;
    manager.rollingFallbackLockTrack = track;
    manager.prepareRollingPlaybackDecisionRecord = () => assert.fail('Same-track retry must skip worker preflight');
    const retry = await manager.preparePlaybackDecisionRecord(track, descriptor);
    assert.equal(retry.committedMode, 'media');
    assert.equal(retry.directFile, false);
    assert.equal(manager.rollingTransport, first);
  } finally {
    if (originalWorker) globalThis.Worker = originalWorker;
    else delete globalThis.Worker;
  }
});

test('native path playback accepts small or large WAV and FLAC up to six channels with a different source rate', () => {
  const options = { audioContext: { sampleRate: 48000 }, directFile: true, workerAvailable: true,
    audioDecoderAvailable: true, policyMode: RollingPolicyMode.RESOURCE_SAFE_LEGACY, enabledMatrix: [] };
  for (const format of ['wav', 'flac']) {
    const codec = format === 'wav' ? 'pcm-s32' : 'flac';
    for (const byteLength of [64, 512 * 1024 * 1024]) {
      const snapshot = { sourceKind: 'other', createRangeReader() {}, mediaSource: `path.${format}`, byteLength, format };
      const metadata = { decoderConfigVerified: true, codec, decoderConfigCodec: codec, sampleRate: 44100,
        channelCount: 2, totalFrames: 44100, durationSec: 1, containerMimeType: `audio/${format}` };
      assert.equal(evaluateRollingEligibility({ ...options, snapshot, metadata }).eligible, true);
      assert.equal(evaluateRollingEligibility({ ...options, snapshot, metadata, gaplessPlayback: false }).eligible, false);
      assert.equal(evaluateRollingEligibility({ ...options, snapshot: { ...snapshot, hasPlaybackRegion: true }, metadata }).eligible, false);
      assert.equal(evaluateRollingEligibility({ ...options, snapshot, metadata: { ...metadata, channelCount: 6 } }).eligible, true);
      assert.equal(evaluateRollingEligibility({ ...options, snapshot, metadata: { ...metadata, channelCount: 7 } }).eligible, false);
    }
  }
});
