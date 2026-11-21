const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const engineTools = import('../../tools/audio-engine-session.mjs');

function requireBuiltExecutable(context, engineTools, name) {
  const executable = join(engineTools.builtExecutableDirectory(), name);
  if (existsSync(executable)) return executable;

  const message = `Native audio engine executable is missing: ${executable}. Run npm run build:audio-engine.`;
  if (process.env[engineTools.requireExecutableEnv] === '1') assert.fail(message);
  context.skip(message);
  return null;
}

async function checkNullSession(context, variant) {
  const tools = await engineTools;
  const executable = requireBuiltExecutable(context, tools,
    tools.executableNames(process.platform, process.arch)[variant]);
  if (!executable) return;

  await tools.withAudioEngine(executable, ['--backend', 'null'], async session => {
    const { message: hello } = await session.receive('hello');
    assert.equal(hello.version, tools.protocolVersion);
    assert.ok(hello.backends.includes('null'));

    await session.send({ type: 'hello', version: tools.protocolVersion });
    await session.send({ type: 'openSession', sampleRate: 48000, outputChannels: 2, inputChannels: 0, periodFrames: 128 });
    const { message: opened } = await session.receive('sessionState', message => message.state === 'open');
    assert.equal(opened.sampleRate, 48000);
    assert.equal(opened.outputChannels, 2);
    assert.equal(opened.inputChannels, 0);
    assert.equal(opened.periodFrames, 128);
    assert.equal(opened.width, 2);

    const frames = 193;
    const planar = Buffer.alloc(2 * frames * Float32Array.BYTES_PER_ELEMENT);
    for (let i = 0; i < frames; i += 1) {
      planar.writeFloatLE((i % 17) / 20, i * 4);
      planar.writeFloatLE(-(i % 29) / 30, (frames + i) * 4);
    }
    await session.send({ type: 'renderNull', frames }, planar);
    const { message: rendered, attachment } = await session.receive('nullOutput');
    assert.equal(rendered.frames, frames);
    assert.equal(rendered.channelCount, 2);
    assert.equal(attachment.length, planar.length);
    for (let offset = 0; offset < planar.length; offset += 4) {
      const actual = attachment.readFloatLE(offset);
      const expected = planar.readFloatLE(offset);
      assert.ok(Math.abs(actual - expected) < 1e-6, `sample ${offset / 4}: ${actual} differs from ${expected}`);
    }

    await session.send({ type: 'closeSession' });
    await session.receive('sessionState', message => message.state === 'closed');
    const { code, signal, diagnostics } = await session.finish();
    assert.equal(signal, null, diagnostics);
    assert.equal(code, 0, diagnostics);
  });
}

test('native audio engine baseline opens, renders and closes a null session over stdio',
  context => checkNullSession(context, 'baseline'));

test('rebuilding a running device holds all output until the matching restore finishes', async context => {
  const tools = await engineTools;
  const executable = requireBuiltExecutable(context,tools,tools.executableNames(process.platform,process.arch).baseline);
  if (!executable) return;
  await tools.withAudioEngine(executable,['--backend','null'],async session => {
    const peak = async () => {
      await session.send({type:'testReadOutput'});
      return (await session.receive('testOutput')).message;
    };
    const release = async id => {
      await session.send({type:'releaseRecovery',recoveryId:id});
      return (await session.receive('recoveryReleased',m => m.recoveryId === id)).message.accepted;
    };
    const waitFrames = async frames => {
      await session.receive('clock', m => m.pipelineFrame >= frames);
    };
    await session.receive('hello');
    await session.send({type:'hello',version:1});
    await session.send({type:'openSession',sampleRate:48000,outputChannels:4,inputDeviceId:'null-in'});
    assert.equal((await session.receive('dspReady')).message.recoveryId,0);
    await session.send({type:'testSetInput',level:.25});
    assert.equal((await session.receive('testInputSet')).message.accepted,true);
    await session.send({type:'startStream'});
    await waitFrames(8192);
    assert.ok((await peak()).peak > .2,'the test input reached the real-time device');
    await session.send({type:'testDeviceReset',outputChannels:2});
    const id = (await session.receive('dspReady')).message.recoveryId;
    assert.ok(id > 0);
    await peak();
    assert.equal(await release(id+1),false);
    await waitFrames(8192);
    const muted = await peak();
    assert.ok(muted.frames >= 4096);
    assert.equal(muted.peak,0);
    assert.equal(await release(id),true);
    assert.equal(await release(id),false);
    await waitFrames(16384);
    assert.ok((await peak()).peak > .2);
    await session.send({type:'stopStream'});
    await session.receive('sessionState',m => m.state === 'stopped');
    await peak();
    await session.send({type:'testSetInput',level:0});
    await session.receive('testInputSet');
    await session.send({type:'startStream'});
    await session.receive('sessionState',m => m.state === 'running');
    let framesAfterRestart = 0;
    do {
      await session.receive('clock');
      const restarted = await peak();
      assert.equal(restarted.peak,0,'Restart replayed audio from the previous capture clock.');
      framesAfterRestart += restarted.frames;
    } while (framesAfterRestart < 4096);
    await session.send({type:'closeSession'});
    await session.receive('sessionState',m => m.state === 'closed');
    assert.equal((await session.finish()).code,0);
  },{env:{...process.env,EFFETUNE_AUDIO_ENGINE_NULL:'1'}});
});
test('native audio engine v3 opens, renders and closes a null session over stdio',
  { skip: process.arch !== 'x64' }, context => checkNullSession(context, 'v3'));

test('native audio engine rejects an oversized frame before reading its body', async context => {
  const tools = await engineTools;
  const { baseline } = tools.executableNames(process.platform, process.arch);
  const executable = requireBuiltExecutable(context, tools, baseline);
  if (!executable) return;

  await tools.withAudioEngine(executable, ['--backend', 'null'], async session => {
    await session.receive('hello');
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(tools.maximumFrameBytes + 1);
    await session.write(prefix);
    assert.equal(await session.readFrame(), null);
    const { code, signal } = await session.finish();
    assert.equal(signal, null);
    assert.ok(Number.isInteger(code) && code !== 0);
  });
});

test('native audio engine enumerates the null backend as JSON without opening a session', async context => {
  const tools = await engineTools;
  const { baseline } = tools.executableNames(process.platform, process.arch);
  const executable = requireBuiltExecutable(context, tools, baseline);
  if (!executable) return;

  const result = spawnSync(executable, ['--list-devices', '--backend', 'null'], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  const listing = JSON.parse(result.stdout);
  assert.equal(listing.backend, 'null');
  assert.ok(Array.isArray(listing.inputs));
  assert.ok(Array.isArray(listing.outputs));
});

test('native audio engine network PCM acknowledgements keep the same source epoch flowing', async context => {
  const tools = await engineTools;
  const { baseline } = tools.executableNames(process.platform, process.arch);
  const executable = requireBuiltExecutable(context, tools, baseline);
  if (!executable) return;

  await tools.withAudioEngine(executable, ['--backend', 'null'], async session => {
    await session.receive('hello');
    await session.send({ type: 'hello', version: tools.protocolVersion });
    await session.send({ type: 'openSession', sampleRate: 44100, outputChannels: 2, inputChannels: 0, periodFrames: 128 });
    await session.receive('sessionState', message => message.state === 'open');
    await session.send({ type: 'setNetworkOutputPort', attached: true });

    const frames = 2048;
    const input = Buffer.alloc(2 * frames * Float32Array.BYTES_PER_ELEMENT);
    for (let i = 0; i < frames; i += 1) {
      input.writeFloatLE(0.25, i * 4);
      input.writeFloatLE(-0.5, (frames + i) * 4);
    }
    let epoch;
    for (let packet = 0; packet < 10; packet += 1) {
      await session.send({ type: 'renderNull', frames }, input);
      await session.receive('nullOutput');
      const network = await session.readFrame();
      assert.equal(network.kind, 4);
      assert.equal(network.message.type, 'pcm');
      assert.equal(network.message.frames, frames);
      assert.equal(network.message.sampleRate, 44100);
      assert.equal(network.message.channelCount, 2);
      assert.equal(network.attachment.length, frames * 2 * Int16Array.BYTES_PER_ELEMENT);
      assert.ok(network.attachment.readInt16LE(0) > 0 && network.attachment.readInt16LE(2) < 0);
      epoch ??= network.message.sourceEpoch;
      assert.equal(network.message.sourceEpoch, epoch);
      assert.equal(network.message.sourceFrame, packet * frames);
      await session.send({ type: 'pcm-ack', sourceEpoch: epoch, sourceFrame: network.message.sourceFrame });
    }
    const { code, signal, diagnostics } = await session.finish();
    assert.equal(signal, null, diagnostics);
    assert.equal(code, 0, diagnostics);
  });
});

test('native audio engine v3 reports its dedicated unsupported CPU exit code', async context => {
  const tools = await engineTools;
  const { v3 } = tools.executableNames(process.platform, process.arch);
  if (!v3) {
    context.skip('Only x64 ships a v3 executable.');
    return;
  }
  const executable = requireBuiltExecutable(context, tools, v3);
  if (!executable) return;

  const env = { ...process.env, [tools.forceBaselineEnv]: '1' };
  await tools.withAudioEngine(executable, ['--backend', 'null'], async session => {
    assert.equal(await session.readFrame(), null);
    const { code, signal, diagnostics } = await session.finish();
    assert.equal(signal, null, diagnostics);
    assert.equal(code, tools.unsupportedCpuExitCode, diagnostics);
  }, { env });
});

test('the running native engine drains a burst of control work in order', async context => {
  const tools = await engineTools;
  const names = tools.executableNames(process.platform,process.arch);
  const executable = requireBuiltExecutable(context,tools,names.baseline);
  if (!executable) return;
  await tools.withAudioEngine(executable,['--backend','null'],async session => {
    await session.receive('hello');
    await session.send({type:'hello',version:tools.protocolVersion});
    await session.send({type:'openSession',outputDeviceId:'default',sampleRate:48000,outputChannels:2,latency:'playback'});
    await session.receive('sessionState',message => message.state === 'open');
    await session.send({type:'startStream'});
    await session.receive('sessionState',message => message.state === 'running');
    const count=256;
    await Promise.all(Array.from({length:count},(_,requestId) => session.send({type:'requestDspLatency',requestId})));
    for(let requestId=0;requestId<count;++requestId){
      const reply=await session.receive('dspLatencyResponse');
      assert.equal(reply.message.requestId,requestId);
    }
    assert.equal((await session.finish()).code,0);
  },{env:{...process.env,EFFETUNE_AUDIO_ENGINE_NULL:'1'}});
});
