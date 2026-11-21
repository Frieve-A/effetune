import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { builtExecutableDirectory, executableNames, protocolVersion, withAudioEngine } from './audio-engine-session.mjs';

const { platform, arch } = process;
const backend = platform === 'win32' ? 'wasapi' : 'miniaudio';
const { baseline, v3 } = executableNames(platform, arch);
const directory = builtExecutableDirectory();
const probe = spawnSync(join(directory, baseline), ['--list-devices', '--backend', backend], {
  encoding: 'utf8', timeout: 15_000, windowsHide: true,
});
if (probe.error) throw probe.error;
assert.equal(probe.status, 0, probe.stderr);
const listing = JSON.parse(probe.stdout);
assert.ok(typeof listing.backend === 'string' && Array.isArray(listing.outputs) && Array.isArray(listing.inputs),
  'Native audio device listing is invalid.');

const output = listing.outputs.find(device => device.isDefault) ?? listing.outputs[0];
const input = listing.inputs.find(device => device.isDefault);
if (process.argv[2] === '--list-only') {
  console.log(`${listing.backend || backend}: ${listing.outputs.length} playback and ${listing.inputs.length} capture devices.`);
} else if (!output || (platform === 'linux' && listing.backend !== 'PulseAudio')) {
  console.log(`Skipped native audio device smoke. ${platform === 'linux' ? 'WSLg PulseAudio is unavailable.' : 'No playback device is available.'}`);
} else {
  for (const name of [baseline, v3].filter(Boolean)) await smokeDevice(join(directory, name));
}

async function smokeDevice(executable) {
  await withAudioEngine(executable, ['--backend', backend, '--mute-device-output'], async session => {
    const { message: hello } = await session.receive('hello');
    assert.equal(hello.version, protocolVersion);
    assert.ok(hello.backends.includes(backend));
    await session.send({ type: 'hello', version: protocolVersion });

    async function open(rate) {
      await session.send({
        type: 'openSession', outputDeviceId: output.isDefault ? 'default' : output.id,
        inputDeviceId: input ? 'default' : '', sampleRate: rate, outputChannels: Math.min(2, output.channels),
      });
      const { message } = await session.receive('sessionState');
      if (message.state !== 'open') {
        const { diagnostics } = await session.finish();
        assert.fail(`${listing.backend} could not open the audio session (${message.reason}). ${diagnostics}`.trim());
      }
      assert.equal(message.sampleRate, rate);
      assert.equal(message.inputChannels, input ? Math.min(input.channels, 16) : 0);
      assert.ok(message.deviceRate > 0 && message.periodFrames > 0 && message.outputLatencyFrames >= 0);
      await session.receive('dspReady');
      return message;
    }

    async function state(type, expected) {
      await session.send({ type });
      const { message } = await session.receive('sessionState');
      assert.equal(message.state, expected, JSON.stringify(message));
    }

    let opened = await open(48000);
    if (opened.sampleRate !== opened.deviceRate) {
      await state('closeSession', 'closed');
      opened = await open(opened.deviceRate);
    }
    for (let round = 0; round < 2; round += 1) {
      if (round === 1) opened = await open(opened.deviceRate === 44100 ? 48000 : 44100);
      assert.equal(opened.deviceRate === opened.sampleRate, round === 0);
      if (input) await session.send({ type: 'setInputMix', enabled: true });
      await state('startStream', 'running');
      const { message: first } = await session.receive('clock');
      assert.ok(Number.isSafeInteger(first.pipelineFrame) && first.timeNs > 0);
      const { message: settled } = await session.receive('clock', message =>
        message.pipelineFrame >= first.pipelineFrame + opened.sampleRate && (!input || message.captureFifoState === 'running'));
      const endFrame = settled.pipelineFrame + opened.sampleRate * 2;
      const { message: last } = await session.receive('clock', message => message.pipelineFrame >= endFrame);
      const measuredRate = (last.pipelineFrame - settled.pipelineFrame) * 1e9 / (last.timeNs - settled.timeNs);
      assert.ok(Math.abs(measuredRate / opened.sampleRate - 1) < 0.1, `Pipeline clock advanced at ${measuredRate} Hz.`);
      if (input) {
        const nominal = opened.captureRate / opened.sampleRate;
        assert.equal(last.captureFifoState, 'running');
        assert.ok(Math.abs(last.captureRatio / nominal - 1) < 0.0021, 'Capture resampling ratio must stay within the drift limit.');
        assert.equal(last.captureUnderruns, settled.captureUnderruns, 'Capture underruns increased after priming.');
      }
      if (round === 1) assert.ok(last.outputConverterDelayFrames > 0, 'output sample-rate conversion must be active');
      await state('stopStream', 'stopped');
      await state('startStream', 'running');
      await session.receive('clock', message => message.pipelineFrame > last.pipelineFrame);
      await state('stopStream', 'stopped');
      await state('closeSession', 'closed');
      console.log(JSON.stringify({ backend: listing.backend, executable, session: opened, counters: last }));
    }

    const { code, signal, diagnostics } = await session.finish();
    assert.equal(signal, null, diagnostics);
    assert.equal(code, 0, diagnostics);
    if (platform === 'win32') assert.doesNotMatch(diagnostics, /could not enable the audio thread priority/);
    if (diagnostics) console.log(diagnostics);
  });
}
