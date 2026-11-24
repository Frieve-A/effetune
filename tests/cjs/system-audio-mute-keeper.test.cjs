const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createSystemAudioMuteKeeper } = require('../../electron/system-audio-mute-keeper.cjs');

function fakeHelpers() {
  const helpers = [];
  const spawn = () => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), killed: false, input: '' });
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', chunk => { child.input += chunk; });
    child.stdin.on('finish', () => child.emit('exit'));
    child.kill = () => { child.killed = true; };
    helpers.push(child);
    return child;
  };
  return { helpers, spawn };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('A native mute hold stays on the selected endpoint across a default endpoint switch', async t => {
  const { helpers, spawn } = fakeHelpers();
  let defaultEndpoint = 'source-A';
  const keeper = createSystemAudioMuteKeeper({ spawn(command, args, options) {
    const child = spawn();
    child.endpoint = options.env.EFFETUNE_SYSTEM_AUDIO_ENDPOINT || defaultEndpoint;
    return child;
  } });
  t.after(() => keeper.dispose());
  const endpoint = defaultEndpoint;
  defaultEndpoint = 'source-B';
  const ready = keeper.prepare(endpoint);
  helpers[0].stdout.write('ready 0\n');
  assert.equal(await ready, true);
  const holding = keeper.hold();
  helpers[0].stdout.write('kept\n');
  assert.equal(await holding, true);
  assert.equal(await keeper.prepare(defaultEndpoint), false);
  assert.equal(helpers[0].endpoint, 'source-A');
  keeper.release();
  assert.equal(helpers[0].input, 'keep\nrestore\n');
});

test('The mute keeper holds the mute from the first capture until the last one stops', async () => {
  const { helpers, spawn } = fakeHelpers();
  const keeper = createSystemAudioMuteKeeper({ spawn });
  const ready = keeper.prepare();
  helpers[0].stdout.write('ready 0\r\n');
  await ready;
  keeper.hold();
  // A second capture while one is held reuses the helper and its original state.
  await keeper.prepare();
  keeper.hold();
  keeper.release();
  await flush();
  assert.equal(helpers.length, 1);
  assert.equal(helpers[0].input, 'keep\n');
  keeper.release();
  keeper.release();
  await flush();
  assert.equal(helpers[0].input, 'keep\nrestore\n');
  assert.equal(helpers[0].stdin.writableEnded, true);
  assert.equal(helpers[0].killed, false);
});

test('A reset restores the mute for captures that ended without releases', async () => {
  const { helpers, spawn } = fakeHelpers();
  const keeper = createSystemAudioMuteKeeper({ spawn });
  const ready = keeper.prepare();
  helpers[0].stdout.write('ready 1\n');
  await ready;
  keeper.hold();
  keeper.hold();
  keeper.reset();
  await flush();
  assert.equal(helpers[0].input, 'keep\nrestore\n');
});

test('Concurrent prepares wait for one helper', async t => {
  const { helpers, spawn } = fakeHelpers();
  const keeper = createSystemAudioMuteKeeper({ spawn });
  t.after(() => keeper.dispose());
  const first = keeper.prepare();
  const second = keeper.prepare();
  assert.equal(helpers.length, 1);
  helpers[0].stdout.write('ready 0\n');
  await Promise.all([first, second]);
  keeper.hold();
  keeper.release();
  assert.equal(helpers[0].input, 'keep\nrestore\n');
});

test('Native mute confirmation follows the endpoint response, timeout and helper exit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { helpers, spawn } = fakeHelpers();
  const keeper = createSystemAudioMuteKeeper({ spawn, logger: { error() {} } });
  t.after(() => keeper.dispose());
  for (const outcome of ['kept', 'exit', 'timeout']) {
    const ready = keeper.prepare();
    await flush();
    const child = helpers.at(-1);
    child.stdout.write('ready 0\n');
    assert.equal(await ready, true);
    const held = keeper.hold();
    if (outcome === 'kept') {
      child.stdout.write('ke');
      child.stdout.write('pt\r\n');
      assert.equal(await held, true);
      assert.equal(await keeper.hold(), true);
      keeper.release();
    } else {
      if (outcome === 'exit') child.emit('exit');
      else t.mock.timers.tick(3000);
      assert.equal(await held, false);
    }
    keeper.release();
  }
});

test('Reset cancels a starting helper and allows a fresh prepare', async t => {
  const { helpers, spawn } = fakeHelpers();
  const keeper = createSystemAudioMuteKeeper({ spawn });
  t.after(() => keeper.dispose());
  const first = keeper.prepare();
  keeper.reset();
  assert.equal(helpers[0].killed, true);
  await first;

  const second = keeper.prepare();
  helpers[0].stdout.write('ready 1\n');
  helpers[0].emit('exit');
  helpers[1].stdout.write('ready 0\n');
  await second;
  keeper.hold();
  keeper.release();
  assert.equal(helpers[0].input, '');
  assert.equal(helpers[1].input, 'keep\nrestore\n');
});

test('Disposal stops an unready helper and settles every pending prepare', async () => {
  const { helpers, spawn } = fakeHelpers();
  const keeper = createSystemAudioMuteKeeper({ spawn });
  const first = keeper.prepare();
  const second = keeper.prepare();
  keeper.dispose();
  assert.equal(helpers[0].killed, true);
  await Promise.all([first, second, keeper.prepare()]);
  assert.equal(helpers.length, 1);
  assert.equal(helpers[0].input, '');
});

test('An idle helper is replaced so the next capture reads a fresh mute state', async () => {
  const { helpers, spawn } = fakeHelpers();
  const keeper = createSystemAudioMuteKeeper({ spawn });
  let ready = keeper.prepare();
  helpers[0].stdout.write('ready 0\n');
  await ready;
  ready = keeper.prepare();
  helpers[1].stdout.write('ready 0\n');
  assert.equal(await ready, true);
  assert.equal(helpers[0].killed, true);
  keeper.dispose();
  assert.equal(helpers[1].killed, true);
});

test('A replacement keeper reads the endpoint after its predecessor restores the mute', async t => {
  const { helpers, spawn } = fakeHelpers();
  const keeper = createSystemAudioMuteKeeper({ spawn });
  t.after(() => keeper.dispose());
  const first = keeper.prepare();
  const previous = helpers[0];
  previous.stdout.write('ready 0\n');
  await first;
  const held = keeper.hold();
  previous.stdout.write('kept\n');
  assert.equal(await held, true);
  previous.stdin.removeAllListeners('finish');
  keeper.release();
  const next = keeper.prepare();
  await flush();
  assert.equal(helpers.length, 1);
  previous.emit('exit');
  await flush();
  assert.equal(helpers.length, 2);
  helpers[1].stdout.write('ready 0\n');
  assert.equal(await next, true);
});

test('Captures continue without the kept mute when the helper does not start', async t => {
  const logger = { error: t.mock.fn() };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { helpers, spawn } = fakeHelpers();
  const keeper = createSystemAudioMuteKeeper({ spawn, logger });
  const ready = keeper.prepare();
  t.mock.timers.tick(3000);
  assert.equal(await ready, false);
  assert.equal(helpers[0].killed, true);
  keeper.hold();
  keeper.release();
  await flush();
  assert.equal(helpers[0].input, '');
  assert.deepEqual(logger.error.mock.calls.map(call => call.arguments), [
    ['System Audio mute keeper is unavailable.']
  ]);
});
