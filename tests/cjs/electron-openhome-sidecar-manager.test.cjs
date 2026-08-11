const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  MAX_OUTBOUND_QUEUE_BYTES,
  OpenHomeSidecarManager,
  PROTOCOL_VERSION,
  STARTUP_TIMEOUT_MS
} = require('../../electron/openhome-sidecar-manager.cjs');

class FakeStream extends EventEmitter {
  constructor() {
    super();
    this.writable = true;
    this.writes = [];
    this.writeResults = [];
  }

  write(value) {
    this.writes.push(String(value));
    return this.writeResults.length > 0 ? this.writeResults.shift() : true;
  }
}

function createChild() {
  const child = new EventEmitter();
  child.stdin = new FakeStream();
  child.stdout = new FakeStream();
  child.stderr = new FakeStream();
  child.killCalls = 0;
  child.kill = () => {
    child.killCalls += 1;
    child.emit('exit', null, 'SIGTERM');
  };
  return child;
}

function parseWrites(child) {
  return child.stdin.writes.map(line => JSON.parse(line));
}

test('OpenHome sidecar waits for the protocol handshake and bounds actions', async () => {
  const child = createChild();
  const actions = [];
  const statuses = [];
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'sidecar.exe',
    fileSystem: { statSync: () => ({ isFile: () => true }) },
    processFactory: sidecarPath => {
      assert.equal(sidecarPath, 'sidecar.exe');
      return child;
    }
  });
  manager.on('action', action => actions.push(action));
  manager.on('status', status => statuses.push(status.state));

  assert.equal(manager.start({ friendlyName: 'Living Room', udn: 'uuid:test' }), true);
  assert.deepEqual(parseWrites(child)[0], {
    type: 'configure',
    protocolVersion: PROTOCOL_VERSION,
    device: { friendlyName: 'Living Room', udn: 'uuid:test' }
  });

  child.stdout.emit('data', `${JSON.stringify({
    type: 'action', requestId: 'early', service: 'Playlist', action: 'Play', args: {}
  })}\n`);
  assert.equal(actions.length, 0);
  assert.equal(parseWrites(child).at(-1).error.code, 'not-ready');

  child.stdout.emit('data', `${JSON.stringify({ type: 'ready', protocolVersion: 1 })}\n`);
  child.stdout.emit('data', `${JSON.stringify({
    type: 'action', requestId: 'a1', service: 'Playlist', action: 'Play', args: {}
  })}\n`);
  assert.deepEqual(actions, [{
    requestId: 'a1', service: 'Playlist', action: 'Play', args: {}
  }]);
  assert.equal(manager.respond('a1', { accepted: true }), true);
  assert.deepEqual(parseWrites(child).at(-1), {
    type: 'response', requestId: 'a1', ok: true, result: { accepted: true }
  });
  assert.deepEqual(statuses, ['starting', 'ready']);

  const stopPromise = manager.stop();
  assert.equal(parseWrites(child).at(-1).type, 'shutdown');
  child.emit('exit', 0, null);
  await stopPromise;
  assert.equal(manager.getStatus().state, 'stopped');
});

test('OpenHome sidecar fails closed when the native executable is absent', () => {
  let spawned = false;
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'missing.exe',
    fileSystem: { statSync: () => { throw new Error('missing'); } },
    processFactory: () => {
      spawned = true;
      return createChild();
    }
  });

  assert.equal(manager.start(), false);
  assert.equal(spawned, false);
  assert.deepEqual(manager.getStatus(), { state: 'unavailable', available: false });
});

test('OpenHome sidecar stops a process that never completes its startup handshake', async () => {
  const child = createChild();
  const timers = [];
  const diagnostics = [];
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'sidecar.exe',
    fileSystem: { statSync: () => ({ isFile: () => true }) },
    processFactory: () => child,
    setTimer: (callback, milliseconds) => {
      const timer = { callback, milliseconds, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: timer => { timer.cleared = true; }
  });
  manager.on('diagnostic', diagnostic => diagnostics.push(diagnostic));

  assert.equal(manager.start(), true);
  assert.equal(timers[0].milliseconds, STARTUP_TIMEOUT_MS);
  timers[0].callback();
  assert.equal(manager.getStatus().state, 'stopping');
  assert.equal(diagnostics.at(-1).code, 'startup-timeout');

  child.emit('exit', 0, null);
  await manager.stop();
  assert.equal(manager.getStatus().state, 'stopped');
});

test('OpenHome sidecar does not report a failed live process as started', () => {
  const child = createChild();
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'sidecar.exe',
    fileSystem: { statSync: () => ({ isFile: () => true }) },
    processFactory: () => child
  });
  manager.start();
  manager.state = 'failed';

  assert.equal(manager.start(), false);
});

test('OpenHome sidecar rejects unknown services without forwarding them', () => {
  const child = createChild();
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'sidecar.exe',
    fileSystem: { statSync: () => ({ isFile: () => true }) },
    processFactory: () => child
  });
  const actions = [];
  manager.on('action', action => actions.push(action));
  manager.start();
  child.stdout.emit('data', `${JSON.stringify({ type: 'ready', protocolVersion: 1 })}\n`);
  child.stdout.emit('data', `${JSON.stringify({
    type: 'action', requestId: 'bad', service: 'Volume', action: 'SetVolume', args: { value: 100 }
  })}\n`);

  assert.equal(actions.length, 0);
  assert.equal(parseWrites(child).at(-1).error.code, 'invalid-action');
});

test('OpenHome sidecar waits for drain after write reports backpressure', async () => {
  const child = createChild();
  child.stdin.writeResults.push(false);
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'sidecar.exe',
    fileSystem: { statSync: () => ({ isFile: () => true }) },
    processFactory: () => child
  });
  manager.start();

  assert.equal(manager.respond('first', { order: 1 }), true);
  assert.equal(manager.respond('second', { order: 2 }), true);
  assert.equal(child.stdin.writes.length, 1);

  child.stdin.emit('drain');
  assert.deepEqual(parseWrites(child).slice(1).map(message => message.requestId), [
    'first', 'second'
  ]);

  const stop = manager.stop();
  child.emit('close', 0, null);
  await stop;
});

test('OpenHome sidecar coalesces queued state to the latest snapshot', async () => {
  const child = createChild();
  child.stdin.writeResults.push(false);
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'sidecar.exe',
    fileSystem: { statSync: () => ({ isFile: () => true }) },
    processFactory: () => child
  });
  manager.start();
  child.stdout.emit('data', `${JSON.stringify({ type: 'ready', protocolVersion: 1 })}\n`);

  assert.equal(manager.publishState({ revision: 1 }), true);
  assert.equal(manager.publishState({ revision: 2 }), true);
  assert.equal(child.stdin.writes.length, 1);
  child.stdin.emit('drain');

  assert.deepEqual(parseWrites(child).slice(1), [{
    type: 'state', snapshot: { revision: 2 }
  }]);
  const stop = manager.stop();
  child.emit('close', 0, null);
  await stop;
});

test('OpenHome sidecar fails closed when its bounded outbound queue overflows', async () => {
  const child = createChild();
  const diagnostics = [];
  child.stdin.writeResults.push(false);
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'sidecar.exe',
    fileSystem: { statSync: () => ({ isFile: () => true }) },
    processFactory: () => child
  });
  manager.on('diagnostic', diagnostic => diagnostics.push(diagnostic));
  manager.start();
  const payload = 'x'.repeat(Math.floor(MAX_OUTBOUND_QUEUE_BYTES / 3));

  assert.equal(manager.respond('first', { payload }), true);
  assert.equal(manager.respond('second', { payload }), true);
  assert.equal(manager.respond('overflow', { payload }), false);
  assert.equal(manager.getStatus().state, 'stopping');
  assert.equal(diagnostics.at(-1).code, 'outbound-overflow');

  const stop = manager.stop();
  child.emit('close', 0, null);
  await stop;
});

test('OpenHome sidecar leaves ready state after an asynchronous stdin error', async () => {
  const child = createChild();
  const diagnostics = [];
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'sidecar.exe',
    fileSystem: { statSync: () => ({ isFile: () => true }) },
    processFactory: () => child
  });
  manager.on('diagnostic', diagnostic => diagnostics.push(diagnostic));
  manager.start();
  child.stdout.emit('data', `${JSON.stringify({ type: 'ready', protocolVersion: 1 })}\n`);

  const error = Object.assign(new Error('pipe closed'), { code: 'EPIPE' });
  assert.doesNotThrow(() => child.stdin.emit('error', error));
  assert.equal(manager.getStatus().state, 'stopping');
  assert.deepEqual(diagnostics, [{ code: 'write-failed', detail: 'EPIPE' }]);

  const stop = manager.stop();
  child.emit('close', null, null);
  await stop;
});

test('OpenHome sidecar settles a stop when process error is followed only by close', async () => {
  const child = createChild();
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'sidecar.exe',
    fileSystem: { statSync: () => ({ isFile: () => true }) },
    processFactory: () => child
  });
  manager.on('diagnostic', () => {});
  manager.start();
  child.stdout.emit('data', `${JSON.stringify({ type: 'ready', protocolVersion: 1 })}\n`);

  child.emit('error', Object.assign(new Error('spawn failure'), { code: 'EIO' }));
  assert.equal(manager.getStatus().state, 'stopping');
  const stop = manager.stop();
  child.emit('close', 1, null);
  await stop;

  assert.equal(manager.getStatus().state, 'stopped');
  assert.equal(manager.child, null);
});

test('OpenHome sidecar settles terminal exit and close only once', async () => {
  const child = createChild();
  const statuses = [];
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'sidecar.exe',
    fileSystem: { statSync: () => ({ isFile: () => true }) },
    processFactory: () => child
  });
  manager.on('status', status => statuses.push(status.state));
  manager.start();

  const stop = manager.stop();
  child.emit('exit', 0, null);
  child.emit('close', 0, null);
  await stop;

  assert.equal(statuses.filter(state => state === 'stopped').length, 1);
  assert.equal(manager.getStatus().state, 'stopped');
});

test('OpenHome sidecar waits for exit after terminating an unresponsive process', async () => {
  const child = createChild();
  const timers = [];
  child.kill = () => {
    child.killCalls += 1;
    return true;
  };
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'sidecar.exe',
    fileSystem: { statSync: () => ({ isFile: () => true }) },
    processFactory: () => child,
    setTimer: callback => {
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: timer => { timer.cleared = true; }
  });
  manager.start();

  const stop = manager.stop();
  timers.find(timer => !timer.cleared).callback();
  assert.equal(child.killCalls, 1);
  assert.equal(manager.getStatus().state, 'stopping');
  assert.equal(manager.child, child);

  child.emit('exit', null, 'SIGTERM');
  await stop;
  assert.equal(manager.getStatus().state, 'stopped');
  assert.equal(manager.child, null);
  assert.equal(timers.at(-1).cleared, true);
});

test('OpenHome sidecar reports failure without discarding a process that never exits', async () => {
  const child = createChild();
  const timers = [];
  const diagnostics = [];
  child.kill = () => {
    child.killCalls += 1;
    return true;
  };
  const manager = new OpenHomeSidecarManager({
    sidecarPath: 'sidecar.exe',
    fileSystem: { statSync: () => ({ isFile: () => true }) },
    processFactory: () => child,
    setTimer: callback => {
      const timer = { callback };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {}
  });
  manager.on('diagnostic', diagnostic => diagnostics.push(diagnostic));
  manager.start();

  const stop = manager.stop();
  timers[1].callback();
  timers[2].callback();
  await stop;

  assert.equal(child.killCalls, 1);
  assert.equal(manager.getStatus().state, 'failed');
  assert.equal(manager.child, child);
  assert.equal(diagnostics.at(-1).code, 'terminate-timeout');
});
