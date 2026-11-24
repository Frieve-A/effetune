import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  builtExecutableDirectory, executableNames, protocolVersion, requireExecutableEnv, withAudioEngine
} from '../../tools/audio-engine-session.mjs';

const rate = 48000;
const bytes = values => Buffer.from(values.buffer, values.byteOffset, values.byteLength);
const samples = frame => new Float32Array(new Uint8Array(frame.attachment).buffer);

test('Native measurement uses physical channels, fixed-ratio conversion and device timestamps', async t => {
  const exe = join(builtExecutableDirectory(), executableNames(process.platform, process.arch).baseline);
  if (!existsSync(exe)) {
    if (process.env[requireExecutableEnv] === '1') assert.fail('Build the native audio engine first.');
    t.skip('Native audio engine is unavailable');
    return;
  }
  await withAudioEngine(exe, ['--backend', 'null'], async session => {
    const receive = async type => (await session.receive(type)).message;
    const send = (type, fields = {}, attachment) => session.send({ type, ...fields }, attachment);
    await receive('hello');
    await send('hello', { version: protocolVersion });
    await send('openSession', { sampleRate: rate, inputChannels: 2, inputDeviceId: 'system-audio', outputChannels: 2 });
    assert.equal((await receive('inputState')).reason, 'unavailable');
    await send('openMeasurement', { inputChannelIndices: [2] });
    assert.equal((await receive('commandRejected')).reason, 'busy');
    await send('closeSession');
    await receive('sessionState');

    for (const deviceRate of [48000, 44100, 96000]) {
      await t.test(`recovers a known delay at ${deviceRate} Hz`, async () => {
        const captureFrames = 32000;
        const delay = 19;
        const available = Math.ceil(captureFrames * deviceRate / rate) + 1000;
        const rendered = new Float32Array(available);
        await send('openMeasurement', { sampleRate: rate, deviceRate, captureRate: deviceRate,
          outputChannels: 2, inputChannelIndices: [1, 2] });
        assert.equal((await receive('measurementState')).state, 'open');
        await send('openSession');
        assert.equal((await receive('commandRejected')).reason, 'busy');
        await send('measurementBegin', { excitationFrames: 64, captureFrames });
        await receive('measurementState');
        const excitation = new Float32Array(128);
        excitation[1] = 1;
        await send('measurementChunk', { offset: 0 }, bytes(excitation));
        await send('measurementStart');
        await receive('measurementState');
        for (let position = 0; position < available; position += 4096) {
          const frames = Math.min(4096, available - position);
          const clock = { position, frames, deviceTimeNs: 2130000 + Math.round(position * 1e9 / deviceRate) };
          await send('renderNullDevice', clock);
          const output = samples(await session.receive('nullOutput'));
          assert(output.subarray(0, frames).every(value => value === 0));
          rendered.set(output.subarray(frames), position);
          const block = new Float32Array(frames * 3);
          block.fill(1, 0, frames); // Unselected channel.
          for (let n = 0; n < frames; n++) {
            if (position + n >= delay) block[2 * frames + n] = rendered[position + n - delay];
          }
          await send('captureNull', { ...clock, channelCount: 3 }, bytes(block));
        }
        await send('measurementStatus');
        const status = await receive('measurementStatus');
        assert.equal(status.status, 'complete');
        assert(status.inputPeak > 0.15 && status.inputPeak <= 0.51);
        await send('measurementRead', { offset: 0, frames: captureFrames });
        const frame = await session.receive('measurementData');
        const capture = samples(frame);
        const peak = Math.max(...capture);
        assert(peak > 0.15 && peak <= 0.51, 'selected channels must be averaged');
        assert.equal(frame.message.captureStartFrame, 0);
        const measuredDelay = capture.indexOf(peak) - frame.message.playbackStartFrame;
        assert(Math.abs(measuredDelay - delay * rate / deviceRate) < 3);
        await send('closeMeasurement');
        assert.equal((await receive('measurementState')).state, 'closed');
      });
    }

    await t.test('repeats one converted excitation period without a filter transient', async () => {
      const excitationFrames = 160;
      for (const deviceRate of [44100, 96000]) {
        await send('openMeasurement', { sampleRate: rate, deviceRate, outputChannels: 2, inputChannelIndices: [0] });
        assert.equal((await receive('measurementState')).state, 'open');
        await send('measurementBegin', { excitationFrames, captureFrames: 0, loop: true });
        assert.equal((await receive('measurementState')).state, 'ready');
        const excitation = new Float32Array(excitationFrames * 2);
        for (let i = 0; i < excitationFrames; i++) {
          excitation[2 * i] = 0.25;
          excitation[2 * i + 1] = Math.cos(2 * Math.PI * i / excitationFrames);
        }
        await send('measurementChunk', { offset: 0 }, bytes(excitation));
        await send('measurementStart');
        assert.equal((await receive('measurementState')).state, 'running');
        const period = excitationFrames * deviceRate / rate;
        const frames = period * 3;
        await send('renderNullDevice', { frames, position: 0 });
        const output = samples(await session.receive('nullOutput'));
        for (let i = 0; i < frames; i++) {
          assert(Math.abs(output[i] - 0.25) < 1e-6);
          assert(Math.abs(output[frames + i] - Math.cos(2 * Math.PI * i / period)) < 0.025);
          assert.equal(output[frames + i], output[frames + i % period]);
        }
        await send('closeMeasurement');
        assert.equal((await receive('measurementState')).state, 'closed');
      }
    });

    await send('openMeasurement', { sampleRate: rate, inputChannelIndices: [2] });
    await receive('measurementState');
    for (const mode of ['unknown-clock', 'discontinuity', 'overload', 'loop']) {
      await t.test(mode, async () => {
        await send('measurementBegin', { excitationFrames: 16, captureFrames: mode === 'loop' ? 0 : 16,
          loop: mode === 'loop', overloadPeak: mode === 'overload' ? 0.75 : 0, overloadTailFrames: 3 });
        await receive('measurementState');
        await send('measurementChunk', { offset: 0 }, bytes(new Float32Array(32).fill(0.25)));
        await send('measurementStart');
        await receive('measurementState');
        if (mode === 'loop') {
          await send('renderNullDevice', { frames: 80, position: 0 });
          assert(samples(await session.receive('nullOutput')).every(value => value === 0.25));
        }
        const input = new Float32Array(24);
        input.fill(0.8, 16);
        for (const position of [0, mode === 'discontinuity' ? 16 : 8]) {
          await send('captureNull', { frames: 8, channelCount: 3, position }, bytes(input));
        }
        await send('measurementStatus');
        const status = await receive('measurementStatus');
        const expected = mode === 'loop' ? 'running' : mode === 'discontinuity' ? 'failed' : 'complete';
        assert.equal(status.status, expected);
        if (mode === 'discontinuity') assert.equal(status.reason, 'interrupted');
        if (mode === 'loop') {
          await send('renderNullDevice', { frames: 8, position: 88 });
          assert(samples(await session.receive('nullOutput')).every(value => value === 0));
          input.fill(0.5, 16);
          await send('captureNull', { frames: 8, channelCount: 3, position: 16 }, bytes(input));
          await send('measurementStatus');
          const interrupted = await receive('measurementStatus');
          assert.equal(interrupted.status, 'failed');
          assert.equal(interrupted.reason, 'interrupted');
          assert.equal(interrupted.inputPeak, 0.5);
        }
        if (expected === 'complete') {
          await send('measurementRead', { frames: 16, offset: 0 });
          const frame = await session.receive('measurementData');
          assert.equal(frame.message.playbackStartFrame, null);
          assert.equal(samples(frame).filter(value => value > 0.7).length, mode === 'overload' ? 3 : 16);
          assert.equal(status.overloadStopped, mode === 'overload');
        }
        await send('measurementCancel');
        await receive('measurementState');
        if (mode === 'loop') {
          await send('renderNullDevice', { frames: 16, position: 80 });
          assert(samples(await session.receive('nullOutput')).every(value => value === 0));
        }
      });
    }
    await send('closeMeasurement');
    await receive('measurementState');
    for (const phase of ['upload', 'complete']) {
      await t.test(`device reset during ${phase} requires reopening the measurement devices`, async () => {
        const take = { excitationFrames: 2, captureFrames: 4 };
        await send('openMeasurement', { sampleRate: rate, outputChannels: 1, inputChannelIndices: [0] });
        assert.equal((await receive('measurementState')).state, 'open');
        await send('measurementBegin', take);
        assert.equal((await receive('measurementState')).state, 'ready');
        await send('measurementChunk', { offset: 0 }, bytes(Float32Array.of(1)));
        if (phase === 'complete') {
          await send('measurementChunk', { offset: 1 }, bytes(Float32Array.of(0)));
          await send('measurementStart');
          assert.equal((await receive('measurementState')).state, 'running');
          await send('captureNull', { frames: 4, channelCount: 1 }, bytes(new Float32Array(4)));
          await send('measurementStatus');
          assert.equal((await receive('measurementStatus')).status, 'complete');
        }
        await send('testDeviceReset');
        await send('measurementStatus');
        const reset = await receive('measurementStatus');
        assert.equal(reset.status, 'failed');
        assert.equal(reset.reason, 'deviceLost');
        if (phase === 'upload') {
          await send('measurementChunk', { offset: 1 }, bytes(Float32Array.of(0)));
          assert.equal((await receive('commandRejected')).command, 'measurementChunk');
        }
        for (const [command, args] of [['measurementStart', {}], ['measurementRead', { frames: 1 }]]) {
          await send(command, args);
          assert.equal((await receive('commandRejected')).command, command);
        }
        await send('measurementCancel');
        await receive('measurementState');
        await send('measurementBegin', take);
        assert.equal((await receive('commandRejected')).command, 'measurementBegin');
        await send('closeMeasurement');
        assert.equal((await receive('measurementState')).state, 'closed');
      });
    }
    const end = await session.finish();
    assert.equal(end.code, 0, end.diagnostics);
  });
});
