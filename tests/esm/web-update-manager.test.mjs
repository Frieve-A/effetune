import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { WebUpdateManager } from '../../js/web-update-manager.js';

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type) { for (const callback of this.listeners.get(type) || []) callback(); }
}

class Worker extends Events {
  constructor(build, activate) {
    super();
    this.build = build;
    this.state = 'installed';
    this.activate = activate;
  }
  postMessage(message, ports) {
    if (message.type === 'GET_BUILD') ports[0].postMessage({ build: this.build });
    if (message.type === 'ACTIVATE_UPDATE') this.activate?.(message);
  }
}

function fixture(timeout = 100) {
  const calls = [];
  const storage = new Map();
  const serviceWorker = new Events();
  serviceWorker.controller = new Worker('old');
  const window = Object.assign(new Events(), {
    document: Object.assign(new Events(), { visibilityState: 'visible' }),
    navigator: { serviceWorker, onLine: true },
    MessageChannel,
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    location: { reload() { calls.push('reload'); } },
    app: {
      initialized: true,
      async prepareWebUpdate() {
        calls.push('prepare');
        return () => calls.push('restore');
      },
      uiManager: {
        stateManager: { updateWebUpdateAvailability() {} },
        setError(key, error) { calls.push([key, error]); }
      }
    }
  });
  const registration = Object.assign(new Events(), {
    waiting: null,
    installing: null,
    async update() { calls.push('check'); }
  });
  const manager = new WebUpdateManager(window, { warn() {} }, timeout);
  manager.registration = registration;
  return { manager, registration, window, calls, storage, serviceWorker };
}

async function until(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Test condition timed out.');
    await setImmediate();
  }
}

test('an update is announced only after installation and application readiness', async () => {
  const f = fixture();
  const downloading = new Worker('new');
  downloading.state = 'installing';
  f.registration.installing = downloading;
  const checking = f.manager.check(true);
  await setImmediate();
  assert.equal(f.manager.busy, true);
  assert.equal(f.calls.some(call => call[0] === 'status.updateCurrent'), false);
  f.registration.waiting = downloading;
  f.registration.installing = null;
  downloading.state = 'installed';
  downloading.emit('statechange');
  await checking;
  assert.equal(f.manager.waitingBuild, 'new');
  assert.equal(f.calls.some(call => call[0] === 'status.updateReady'), false);
  await f.manager.onApplicationReady();
  assert.equal(f.calls.filter(call => call[0] === 'status.updateReady').length, 1);
  await f.manager.check();
  assert.equal(f.calls.filter(call => call[0] === 'status.updateReady').length, 1);
});

test('startup and visible, online, and pageshow events check for updates', async () => {
  const f = fixture();
  f.manager.attach(f.registration);
  await until(() => !f.manager.busy);
  f.window.document.visibilityState = 'hidden';
  f.window.document.emit('visibilitychange');
  assert.equal(f.calls.filter(call => call === 'check').length, 1);
  for (const [surface, event] of [
    [f.window.document, 'visibilitychange'], [f.window, 'online'], [f.window, 'pageshow']
  ]) {
    f.window.document.visibilityState = 'visible';
    surface.emit(event);
    await until(() => !f.manager.busy);
  }
  assert.equal(f.calls.filter(call => call === 'check').length, 4);
});

test('failed or offline downloads never report that the app is current', async () => {
  const f = fixture();
  await f.manager.onApplicationReady();
  f.registration.update = async () => { throw new Error('download failed'); };
  await f.manager.check(true);
  f.window.navigator.onLine = false;
  await f.manager.check(true);
  assert.equal(f.calls.filter(call => call[0] === 'error.updateCheckFailed').length, 2);
  assert.equal(f.calls.some(call => call[0] === 'status.updateCurrent'), false);
  assert.equal(f.manager.busy, false);
});

test('startup discovers and can apply a downloaded update when offline or the network check fails', async () => {
  for (const offline of [true, false]) {
    const f = fixture();
    await f.manager.onApplicationReady();
    f.window.navigator.onLine = !offline;
    f.registration.update = async () => { throw new Error('network unavailable'); };
    const next = new Worker('downloaded', () => {
      f.serviceWorker.controller = next;
      f.serviceWorker.emit('controllerchange');
    });
    f.registration.waiting = next;
    f.manager.attach(f.registration);
    await until(() => !f.manager.busy && f.manager.waitingBuild === 'downloaded');
    assert.equal(f.calls.some(call => call[0] === 'status.updateReady'), true);
    await f.manager.check(true);
    assert.equal(f.manager.waitingBuild, 'downloaded');
    assert.equal(f.calls.some(call => call[0] === 'error.updateCheckFailed'), false);
    await f.manager.apply();
    assert.equal(f.calls.filter(call => call === 'reload').length, 1);
  }
});

test('startup inspects the downloaded update without waiting for the network check', async () => {
  const f = fixture();
  let finishCheck;
  f.registration.update = () => new Promise(resolve => { finishCheck = resolve; });
  f.registration.waiting = new Worker('downloaded');
  f.manager.attach(f.registration);
  await until(() => f.manager.waitingBuild === 'downloaded');
  assert.equal(f.manager.busy, true);
  finishCheck();
  await until(() => !f.manager.busy);
});

test('an installation that becomes redundant during update is reported as a failure', async () => {
  const f = fixture();
  await f.manager.onApplicationReady();
  f.manager.attach(f.registration);
  await until(() => !f.manager.busy);
  f.registration.update = async () => {
    const failed = new Worker('new');
    failed.state = 'installing';
    f.registration.installing = failed;
    f.registration.emit('updatefound');
    failed.state = 'redundant';
    f.registration.installing = null;
    failed.emit('statechange');
  };
  await f.manager.check(true);
  assert.equal(f.calls.some(call => call[0] === 'error.updateCheckFailed'), true);
  assert.equal(f.calls.some(call => call[0] === 'status.updateCurrent'), false);
});

test('applying saves and fades before activation, waits for the target controller, and reloads once', async () => {
  const f = fixture();
  await f.manager.onApplicationReady();
  let finishPrepare;
  f.window.app.prepareWebUpdate = () => {
    f.calls.push('prepare');
    return new Promise(resolve => { finishPrepare = () => resolve(() => f.calls.push('restore')); });
  };
  const next = new Worker('new', message => {
    assert.equal(message.build, 'new');
    f.calls.push('activate');
  });
  f.registration.waiting = next;
  const applying = f.manager.apply();
  await until(() => Boolean(finishPrepare));
  assert.equal(f.calls.includes('activate'), false);
  finishPrepare();
  await until(() => f.calls.includes('activate'));
  assert.equal(f.calls.includes('reload'), false);
  f.serviceWorker.emit('controllerchange');
  await setImmediate();
  assert.equal(f.calls.includes('reload'), false);
  f.serviceWorker.controller = next;
  f.serviceWorker.emit('controllerchange');
  await applying;
  await f.manager.apply();
  assert.equal(f.calls.filter(call => call === 'reload').length, 1);
  assert.equal(f.calls.includes('restore'), false);
  assert.equal(f.storage.get('effetune_pending_web_update'), 'new');
  assert.deepEqual(f.calls.filter(call => typeof call === 'string'), ['prepare', 'activate', 'reload']);
});

test('activation without a controllerchange event is verified at the timeout before reloading', async () => {
  const f = fixture(5);
  f.registration.waiting = new Worker('new', () => {
    f.serviceWorker.controller = f.registration.waiting;
  });
  await f.manager.apply();
  assert.equal(f.calls.filter(call => call === 'reload').length, 1);
});

test('activation failure restores playback even if clearing update state fails', async () => {
  const f = fixture(5);
  await f.manager.onApplicationReady();
  f.registration.waiting = new Worker('new');
  f.window.sessionStorage.removeItem = () => { throw new Error('storage unavailable'); };
  await f.manager.apply();
  assert.equal(f.calls.includes('restore'), true);
  assert.equal(f.calls.includes('reload'), false);
  assert.equal(f.calls.some(call => call[0] === 'error.updateApplyFailed'), true);
  assert.equal(f.manager.busy, false);
});

test('preparation failure never activates the update', async () => {
  const f = fixture();
  f.registration.waiting = new Worker('new', () => f.calls.push('activate'));
  f.window.app.prepareWebUpdate = async () => { throw new Error('save failed'); };
  await f.manager.apply();
  assert.equal(f.calls.includes('activate'), false);
  assert.equal(f.calls.includes('reload'), false);
});

test('the next successful startup verifies the requested build before announcing completion', async () => {
  for (const build of ['new', 'old']) {
    const f = fixture();
    f.storage.set('effetune_pending_web_update', 'new');
    f.serviceWorker.controller = new Worker(build);
    assert.equal(f.calls.length, 0);
    await f.manager.onApplicationReady();
    assert.equal(f.calls.some(call => call[0] === 'success.appUpdated'), build === 'new');
    assert.equal(f.calls.some(call => call[0] === 'error.updateVerificationFailed'), build !== 'new');
    assert.equal(f.storage.has('effetune_pending_web_update'), false);
  }
});
