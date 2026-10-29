import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SELECTABLE_LANGUAGE_CODES } from '../../js/language-options.js';
import { parseCommentedJSON } from '../../js/utils/parse-commented-json.js';
import { parsePwaPairingLink, validatePwaMediaUrl } from '../../js/network-music/pwa-connection.js';
import { PwaNetworkMusicTransport } from '../../js/network-music/pwa-transport.js';
import { createPwaPlaybackTrack } from '../../js/network-music/pwa-playback-provider.js';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { normalizePlaybackSourceDescriptor, choosePlaybackMode } from '../../js/ui/audio-player/playback-source-policy.js';
import { AudioContextManager } from '../../js/ui/audio-player/audio-context-manager.js';
import { NetworkMusicController } from '../../js/network-music/controller.js';
import { PwaDeviceRegistration } from '../../js/network-music/pwa-registration.js';
import { createFakeDocument } from '../helpers/fake-dom.mjs';

const originA = 'http://192.168.1.20:47300';
const originB = 'https://192.168.1.21:47300';
const media = `${originA}/pwa/v1/media/abcdefghijklmnop`;
const info = (hostId = 'a', extra = {}) => ({ hostId, playerId: `native-player-${hostId}`, libraryId: `native-library-${hostId}`,
  name: `Desktop ${hostId}`, queueTracksMax: 4096,
  capabilities: { playback: true, effects: true, sharing: true, searchSupported: true, catalogSearch: true,
    browseViews: [{ id: 'tracks', objectId: 'view:tracks' }], sortCaps: ['dc:title'] }, ...extra });
const response = (value, status = 200) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(value) });
function fixture() {
  const calls = [];
  const store = new Map();
  let handle = url => url.origin === originA ? info('a') : info('b');
  const options = { windowRef: null, storage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    fetchImpl: async (address, init) => { const url = new URL(address); calls.push({ url, init }); return response(await handle(url, init)); } };
  return { options, calls, store, setHandle: callback => { handle = callback; }, api: new PwaNetworkMusicTransport(options) };
}

function registrationFixture(t) {
  const source = fixture();
  const document = createFakeDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = tag => {
    const element = createElement(tag);
    element.append = (...children) => children.forEach(child => element.appendChild(child));
    element.replaceChildren = (...children) => {
      for (const child of [...element.children]) element.removeChild(child);
      element.append(...children);
    };
    element.remove = () => element.parentNode?.removeChild(element);
    element.focus = () => { document.activeElement = element; };
    if (tag === 'dialog') {
      element.showModal = () => { element.open = true; };
      element.close = () => { element.open = false; };
    }
    return element;
  };
  document.body.append = (...children) => children.forEach(child => document.body.appendChild(child));
  const opened = [];
  const window = { addEventListener: document.addEventListener, removeEventListener: document.removeEventListener,
    open: (...args) => opened.push(args) };
  const registration = new PwaDeviceRegistration({ api: source.api, uiManager: { t: key => key }, documentRef: document, windowRef: window });
  t.after(() => { registration.dispose(); source.api.dispose(); });
  const form = () => registration.dialog.children[2];
  return { ...source, registration, document, window, opened, form,
    submit: () => form().dispatchEvent('submit', { preventDefault() {} }) };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('PWA device registration displays labels and connection results in the selected language', async t => {
  for (const locale of SELECTABLE_LANGUAGE_CODES) {
    const translations = parseCommentedJSON(readFileSync(new URL(`../../js/locales/${locale}.json5`, import.meta.url), 'utf8'));
    const text = key => translations[`networkMusic.pwa.${key}`];
    const { registration, form, submit, setHandle } = registrationFixture(t);
    registration.uiManager.t = key => translations[key] ?? key;
    registration.open();
    assert.equal(registration.dialog.children[0].textContent, text('addDeviceTitle'));
    assert.equal(registration.dialog.children[1].textContent, text('setup'));
    assert.equal(form().children[0].textContent, text('pairingLinkLabel'));
    assert.equal(registration.input.getAttribute('aria-label'), text('pairingLinkLabel'));
    assert.equal(registration.input.title, text('pairingLink'));
    assert.deepEqual(form().children[1].children.map(button => button.textContent),
      ['connect', 'scan'].map(text));
    const footer = registration.dialog.children.at(-1);
    assert.equal(footer.className, 'pwa-device-footer');
    assert.equal(registration.dialog.children.at(-2), registration.savedDevices);
    assert.equal(footer.children[0].textContent, text('close'));
    assert.equal(registration.stopScanButton.textContent, text('stopCamera'));
    assert.equal(form().children.at(-1).textContent, text('openEditor'));

    const pending = deferred();
    setHandle(() => pending.promise);
    registration.input.value = `${originA}/?t=localized-device`;
    const connecting = submit();
    assert.equal(registration.status.textContent, translations['networkMusic.connecting']);
    pending.resolve(info());
    await connecting;
    assert.equal(registration.status.textContent, text('connected'));
    assert.equal(registration.savedDevices.children[0].textContent, text('savedDevices'));
    const row = registration.savedDevices.children[1];
    assert.deepEqual(row.children.map(element => element.textContent), ['Desktop a', text('update'), text('remove')]);
    await row.children[1].dispatchEvent('click');
    assert.equal(registration.dialog.children[0].textContent, `${text('update')} · Desktop a`);
    assert.equal(form().children[1].children[0].textContent, text('update'));
    assert.equal(form().children[1].children[0].title, text('update'));

    for (const key of ['invalidPairingLink', 'connectionFailed', 'registrationExpired', 'differentDevice',
      'pwaUnsupported', 'deviceLimit', 'cameraUnavailable', 'cameraDenied', 'sessionOnly', 'updated', 'storageRemoveFailed']) {
      registration.showStatus(key);
      assert.equal(registration.status.textContent, text(key));
      assert.equal(registration.status.title, text(key));
    }
    await registration.savedDevices.children[1].children[2].dispatchEvent('click');
    assert.equal(registration.status.textContent, text('removed'));
    assert.equal(registration.savedDevices.children.length, 0);
  }
});

function effectsSockets(api, readyState = 1) {
  const sockets = [];
  api.WebSocketImpl = class Socket extends EventTarget {
    constructor() { super(); this.readyState = readyState; this.bufferedAmount = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; }
    emit(type, values = {}) { const event = new Event(type); Object.assign(event, values); this.dispatchEvent(event); }
  };
  return sockets;
}

function cameraRegistrationFixture(t) {
  const source = registrationFixture(t);
  const acquisition = deferred(), detection = deferred(), formats = deferred();
  const requests = [], detectors = [];
  let stops = 0, submission;
  const track = { stop: () => { stops++; } };
  const stream = { getTracks: () => [track] };
  source.window.navigator = { mediaDevices: { getUserMedia: options => { requests.push(options); return acquisition.promise; } } };
  source.window.BarcodeDetector = class {
    static getSupportedFormats() { return formats.promise; }
    constructor(options) { detectors.push(options); }
    detect() { return detection.promise; }
  };
  const open = id => {
    source.registration.open(id);
    source.registration.video.play = async () => {};
    source.registration.input.form = source.form();
    source.form().requestSubmit = () => { submission = source.submit(); };
  };
  return { ...source, acquisition, detection, formats, requests, detectors, stream, open,
    get stops() { return stops; }, get submission() { return submission; } };
}

test('a supported QR scan registers through the pairing form and releases its camera before connecting', { timeout: 3000 }, async t => {
  const camera = cameraRegistrationFixture(t);
  const { registration, api } = camera;
  const registrationResponse = deferred();
  camera.setHandle(() => registrationResponse.promise);
  camera.open();
  const scanButton = camera.form().children[1].children[1];
  assert.equal(scanButton.hidden, true);
  camera.formats.resolve(['qr_code']);
  await Promise.resolve();
  assert.equal(scanButton.hidden, false);
  const scanning = registration.startCamera();
  camera.acquisition.resolve(camera.stream);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(registration.video.srcObject, camera.stream);
  assert.equal(registration.video.hidden, false);
  assert.deepEqual(camera.requests, [{ video: { facingMode: 'environment' }, audio: false }]);
  assert.deepEqual(camera.detectors, [{ formats: ['qr_code'] }]);
  camera.detection.resolve([{ rawValue: `${originA}/?t=qr-pairing-token` }]);
  await scanning;
  assert.equal(camera.stops, 1);
  assert.equal(registration.stream, null);
  assert.equal(registration.video.srcObject, null);
  assert.equal(registration.video.hidden, true);
  assert.equal(registration.stopScanButton.hidden, true);
  assert.equal(registration.status.textContent, 'Connecting…');
  assert.equal(camera.form().children[1].children[0].disabled, true);
  registrationResponse.resolve(info('a'));
  await camera.submission;
  assert.equal(api.records.get('a').token, 'qr-pairing-token');
  assert.equal(registration.input.value, '');
  assert.equal(registration.status.textContent, 'Device added. Select it as your playback device or library.');
  assert.equal(camera.form().children[1].children[0].disabled, false);
  registration.close();
  assert.equal(camera.stops, 1, 'closing after registration must not stop a released track twice');
});

test('camera permission refusal leaves paste registration usable and unsupported formats keep scanning hidden', { timeout: 3000 }, async t => {
  const camera = cameraRegistrationFixture(t);
  camera.open();
  camera.formats.resolve(['qr_code']);
  await Promise.resolve();
  assert.equal(camera.form().children[1].children[1].hidden, false);
  const scanning = camera.registration.startCamera();
  camera.acquisition.reject(new DOMException('Permission denied', 'NotAllowedError'));
  await scanning;
  assert.equal(camera.stops, 0);
  assert.equal(camera.registration.video.hidden, true);
  assert.equal(camera.registration.stopScanButton.hidden, true);
  assert.match(camera.registration.status.textContent, /Allow camera access or paste the link instead/);
  camera.registration.input.value = `${originB}/?t=pasted-after-refusal`;
  await camera.submit();
  assert.equal(camera.api.records.get('b').token, 'pasted-after-refusal');
  assert.match(camera.registration.status.textContent, /^Device added/);
  camera.window.BarcodeDetector.getSupportedFormats = async () => ['ean_13'];
  camera.open();
  await Promise.resolve();
  assert.equal(camera.form().children[1].children[1].hidden, true);
});

test('closing or leaving the page while camera permission is pending releases a late stream without changing the next dialog', { timeout: 3000 }, async t => {
  for (const dismissal of ['close', 'pagehide']) {
    const camera = cameraRegistrationFixture(t);
    camera.formats.resolve(['qr_code']);
    await camera.api.register(`${originB}/?t=saved-device-b`);
    camera.open();
    const scanning = camera.registration.startCamera();
    if (dismissal === 'close') camera.registration.close();
    else await camera.document.dispatchEvent('pagehide');
    camera.open('pwa:b:player');
    camera.registration.input.value = `${originB}/?t=new-link-b`;
    const requests = camera.calls.length;
    camera.acquisition.resolve(camera.stream);
    await scanning;
    assert.equal(camera.stops, 1);
    assert.equal(camera.registration.stream, null);
    assert.equal(camera.registration.video.hidden, true);
    assert.equal(camera.registration.input.value, `${originB}/?t=new-link-b`);
    assert.equal(camera.registration.status.textContent, '');
    assert.equal(camera.registration.hostId, 'b');
    assert.equal(camera.calls.length, requests);
    assert.equal(camera.submission, undefined);
    camera.registration.dispose(); camera.api.dispose();
  }
});

test('a QR result arriving after pagehide cannot register into a different saved-device dialog', { timeout: 3000 }, async t => {
  const camera = cameraRegistrationFixture(t);
  camera.formats.resolve(['qr_code']);
  await camera.api.register(`${originB}/?t=saved-device-b`);
  camera.open();
  const scanning = camera.registration.startCamera();
  camera.acquisition.resolve(camera.stream);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(camera.registration.stream, camera.stream);
  await camera.document.dispatchEvent('pagehide');
  assert.equal(camera.stops, 1);
  camera.open('pwa:b:player');
  camera.registration.input.value = `${originB}/?t=next-dialog-b`;
  const requests = camera.calls.length;
  camera.detection.resolve([{ rawValue: `${originA}/?t=obsolete-qr-token` }]);
  await scanning;
  assert.equal(camera.submission, undefined);
  assert.equal(camera.calls.length, requests);
  assert.equal(camera.api.records.has('a'), false);
  assert.equal(camera.api.records.get('b').token, 'saved-device-b');
  assert.equal(camera.registration.hostId, 'b');
  assert.equal(camera.registration.input.value, `${originB}/?t=next-dialog-b`);
  assert.equal(camera.registration.status.textContent, '');
  assert.equal(camera.stops, 1);
});

test('returning to the foreground refreshes saved-device capabilities and disposal stops visibility discovery', { timeout: 3000 }, async t => {
  const source = fixture();
  const document = createFakeDocument();
  document.visibilityState = 'visible';
  const api = new PwaNetworkMusicTransport({ ...source.options, windowRef: { document } });
  t.after(() => { api.dispose(); source.api.dispose(); });
  await api.register(`${originA}/?t=saved-device-token`);
  assert.equal((await api.remoteClient.getConnection('pwa:a:player')).registered, true);
  document.visibilityState = 'hidden';
  const requests = source.calls.length;
  await document.dispatchEvent('visibilitychange');
  assert.equal(source.calls.length, requests);
  source.setHandle(() => info('a', { name: 'Renamed desktop', capabilities: { playback: true, effects: false, sharing: false } }));
  const refreshed = deferred();
  const unsubscribe = api.onNetworkMusicState(state => refreshed.resolve(state));
  t.after(unsubscribe);
  document.visibilityState = 'visible';
  await document.dispatchEvent('visibilitychange');
  const state = await refreshed.promise;
  assert.equal(source.calls.length, requests + 1);
  assert.equal(state.players[0].name, 'Renamed desktop');
  assert.equal(state.players[0].available, true);
  assert.deepEqual(state.libraries, []);
  assert.equal((await api.remoteClient.getConnection('pwa:a:player')).registered, false);
  api.dispose();
  const afterDispose = source.calls.length;
  await document.dispatchEvent('visibilitychange');
  assert.equal(source.calls.length, afterDispose);
  assert.equal(document.listenerCount('visibilitychange'), 0);
});

test('updating a saved PWA device preserves its host identity and replaces its connection', async t => {
  const { api, registration, submit, setHandle } = registrationFixture(t);
  await api.register(`${originA}/?t=old-token`);
  registration.open();
  await registration.savedDevices.children[1].children[1].dispatchEvent('click');
  assert.equal(registration.hostId, 'a');
  const updates = [];
  const register = api.register.bind(api);
  api.register = (link, hostId) => { updates.push({ link, hostId }); return register(link, hostId); };
  setHandle(() => info('a', { name: 'Updated desktop' }));
  registration.input.value = `${originB}/?t=new-token`;
  await submit();
  assert.deepEqual(updates, [{ link: `${originB}/?t=new-token`, hostId: 'a' }]);
  assert.deepEqual(api.registrations.map(record => record.hostId), ['a']);
  assert.equal(api.records.get('a').origin, originB);
  assert.equal(api.records.get('a').token, 'new-token');
  assert.equal(registration.savedDevices.children[1].children[0].textContent, 'Updated desktop');
  assert.equal(registration.status.textContent, 'Connection updated.');
});

test('removing a PWA device reports a session-only removal when persistence fails', async t => {
  const { api, options, store, registration } = registrationFixture(t);
  await api.register(`${originA}/?t=old-token`);
  const saved = [...store.entries()];
  options.storage.setItem = () => { throw new Error('Storage unavailable'); };
  registration.open();
  await registration.savedDevices.children[1].children[2].dispatchEvent('click');
  assert.equal(api.registrations.length, 0);
  assert.equal(registration.savedDevices.children.length, 0);
  assert.match(registration.status.textContent, /removed for this session.*storage could not be updated/i);
  assert.deepEqual([...store.entries()], saved);
  const reopened = new PwaNetworkMusicTransport(options);
  t.after(() => reopened.dispose());
  assert.deepEqual(reopened.registrations.map(record => record.hostId), ['a']);
});

test('late PWA registration success or failure cannot update a closed or replacement dialog', async t => {
  for (const replacement of [false, true]) for (const succeeds of [false, true]) {
    const { api, registration, form, submit, setHandle, document } = registrationFixture(t);
    await api.register(`${originB}/?t=device-b`);
    let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    setHandle(() => pending);
    registration.open();
    registration.input.value = `${originA}/?t=device-a`;
    const oldInput = registration.input;
    const oldStatus = registration.status;
    const operation = submit();
    assert.equal(form().children[1].children[0].disabled, true);
    if (replacement) {
      registration.open('pwa:b:player');
      registration.input.value = `${originB}/?t=replacement`;
    } else await registration.dialog.children.at(-1).children[0].dispatchEvent('click');
    if (succeeds) resolve(info('a'));
    else reject(new Error('Connection lost'));
    await operation;
    assert.equal(oldInput.value, `${originA}/?t=device-a`);
    assert.equal(oldStatus.textContent, 'Connecting…');
    if (replacement) {
      assert.equal(registration.hostId, 'b');
      assert.equal(registration.input.value, `${originB}/?t=replacement`);
      assert.equal(registration.status.textContent, '');
      assert.equal(form().children[1].children[0].disabled, false);
    } else {
      assert.equal(registration.dialog, null);
      assert.equal(document.body.children.length, 0);
    }
    registration.dispose(); api.dispose();
  }
});

test('unsupported PWA devices offer the remote editor while connection failures allow a new link', async t => {
  const { api, registration, submit, form, opened } = registrationFixture(t);
  registration.open();
  registration.input.value = `${originA}/?t=unsupported-token`;
  api.fetchImpl = async () => response({}, 404);
  await submit();
  const editor = form().children.at(-1);
  assert.equal(editor.hidden, false);
  assert.match(registration.status.textContent, /does not support PWA music playback/);
  await editor.dispatchEvent('click');
  assert.deepEqual(opened, [[`${originA}/?t=unsupported-token`, '_blank', 'noopener,noreferrer']]);
  api.fetchImpl = async () => { throw new Error('Device offline'); };
  registration.input.value = `${originB}/?t=retry-token`;
  await submit();
  assert.equal(editor.hidden, true);
  assert.match(registration.status.textContent, /Could not connect/);
  assert.equal(registration.input.value, `${originB}/?t=retry-token`);
  assert.equal(form().children[1].children[0].disabled, false);
  api.fetchImpl = async () => response(info('b'));
  await submit();
  assert.equal(api.records.get('b').token, 'retry-token');
  assert.equal(registration.input.value, '');
});

test('PWA effects ignore a replaced socket and expire only the device whose authorization closes', async t => {
  const { api } = fixture();
  const sockets = effectsSockets(api);
  await api.register(`${originA}/?t=token-a`);
  await api.register(`${originB}/?t=token-b`);
  const controller = new NetworkMusicController({ api, uiManager: {} });
  controller.applyState(await api.networkMusicGetState());
  controller.selectLibrary('pwa:a:library');
  controller.selectPlayer('pwa:b:player');
  await new Promise(resolve => setImmediate(resolve));
  const unsubscribeState = api.onNetworkMusicState(state => controller.applyState(state));
  const events = [];
  const unsubscribeEvents = api.remoteClient.onEvent(event => events.push(event));
  t.after(() => { unsubscribeEvents(); unsubscribeState(); controller.dispose(); api.dispose(); });
  const first = await api.remoteClient.connect('pwa:a:player');
  sockets[0].emit('open');
  const second = await api.remoteClient.connect('pwa:b:player');
  sockets[1].emit('open');
  events.length = 0;
  sockets[0].emit('message', { data: 'stale state' });
  assert.deepEqual(events, []);
  assert.equal(await api.remoteClient.send(first.connectionId, 'stale command'), false);
  assert.deepEqual(sockets[0].sent, []);
  sockets[1].emit('message', { data: 'current state' });
  assert.deepEqual(events, [{ connectionId: second.connectionId, type: 'message', data: 'current state' }]);
  sockets[0].emit('close', { code: 4401 });
  await Promise.resolve();
  assert.equal(api.records.get('a').authorizationRequired, true);
  assert.equal(api.records.get('a').available, false);
  assert.equal(api.records.get('b').authorizationRequired, undefined);
  assert.equal(api.records.get('b').available, true);
  assert.equal(api.effects.connectionId, second.connectionId);
  assert.equal(events.length, 1);
  sockets[1].emit('close', { code: 4401 });
  await Promise.resolve();
  assert.equal(controller.state.players.find(player => player.id === 'pwa:b:player').authorizationRequired, true);
  assert.equal(controller.state.players.find(player => player.id === 'pwa:b:player').available, false);
  assert.equal(controller.selectedPlayerId, 'pwa:b:player');
  assert.equal(controller.selectedLibraryId, 'pwa:a:library');
});

test('PWA registration aborts unanswered requests on timeout or disposal and releases pending ownership', { timeout: 3000 }, async () => {
  for (const interruption of ['timeout', 'dispose']) {
    const { api, setHandle } = fixture();
    api.requestTimeout = interruption === 'timeout' ? 20 : 2000;
    const aborted = deferred();
    let signal;
    setHandle((_url, init) => new Promise((_, reject) => {
      signal = init.signal;
      signal.addEventListener('abort', () => {
        aborted.resolve();
        reject(new DOMException('Request aborted', 'AbortError'));
      }, { once: true });
    }));
    const guard = setTimeout(() => aborted.reject(new Error('PWA request was not aborted')), 1000);
    try {
      const request = assert.rejects(api.register(`${originA}/?t=pending-registration`), { code: 'connectionFailed' });
      assert.equal(api.pending.size, 1);
      assert.equal(signal.aborted, false);
      if (interruption === 'dispose') api.dispose();
      await aborted.promise;
      await request;
      assert.equal(signal.aborted, true);
      assert.equal(api.pending.size, 0);
      assert.equal(api.records.size, 0);
    } finally {
      clearTimeout(guard);
      api.dispose();
    }
  }
});

test('an effects connection that never opens reports timeout and releases its socket without expiring registration', { timeout: 3000 }, async t => {
  const { api } = fixture();
  t.after(() => api.dispose());
  await api.register(`${originA}/?t=saved-device-token`);
  api.requestTimeout = 20;
  const sockets = effectsSockets(api, 0);
  const closed = deferred(), events = [];
  const guard = setTimeout(() => closed.reject(new Error('PWA effects connection did not time out')), 1000);
  const unsubscribe = api.remoteClient.onEvent(event => { events.push(event); closed.resolve(event); });
  t.after(() => { clearTimeout(guard); unsubscribe(); });
  const connection = await api.remoteClient.connect('pwa:a:player');
  assert.equal(api.effects.connectionId, connection.connectionId);
  assert.equal(sockets[0].readyState, 0);
  assert.deepEqual(await closed.promise, { connectionId: connection.connectionId, type: 'close', code: 1006 });
  assert.equal(api.effects, null);
  assert.equal(sockets[0].readyState, 3);
  assert.equal(events.length, 1);
  assert.equal(await api.remoteClient.send(connection.connectionId, 'late command'), false);
  assert.deepEqual(sockets[0].sent, []);
  assert.equal((await api.remoteClient.getConnection('pwa:a:player')).registered, true);
});

test('PWA browse references retain their source while codec and sharing availability follow the chosen player', { timeout: 3000 }, async t => {
  const { api, calls, setHandle } = fixture();
  const probes = [];
  api.windowRef = { document: {
    createElement(tag) {
      assert.equal(tag, 'audio');
      return { canPlayType(type) { probes.push(type); return type === 'audio/wav' ? 'probably' : ''; } };
    },
    removeEventListener() {}
  } };
  const controller = new NetworkMusicController({ api, uiManager: {} });
  t.after(() => controller.dispose());
  await api.register(`${originA}/?t=saved-device-token`);
  controller.applyState(await api.networkMusicGetState());
  setHandle(url => {
    if (url.pathname === '/pwa/v1/info') return info('a');
    if (url.pathname === '/pwa/v1/player') return { queue: [], protocolInfo: 'http-get:*:audio/x-native-codec:*' };
    assert.equal(url.pathname, '/pwa/v1/browse');
    return { totalMatches: 2, items: [
      { id: 'native-track-1', serverId: 'native-library-a', title: 'Native format', resources: [{ protocolInfo: 'http-get:*:audio/x-native-codec:*' }] },
      { id: 'native-track-2', title: 'Browser format', resources: [{ protocolInfo: 'http-get:*:audio/wav:*' }] }
    ] };
  });
  const page = await api.networkMusicBrowse({ serverId: 'pwa:a:library', objectId: 'view:tracks' });
  assert.deepEqual(page.items.map(({ serverId, trackId }) => ({ serverId, trackId })), [
    { serverId: 'pwa:a:library', trackId: 'native-track-1' },
    { serverId: 'pwa:a:library', trackId: 'native-track-2' }
  ]);
  const afterBrowse = calls.length;
  assert.equal(controller.canPlayItem(page.items[0]), false);
  assert.equal(controller.canPlayItem(page.items[1]), true);
  assert.deepEqual(probes, ['audio/x-native-codec', 'audio/wav']);
  assert.equal(calls.length, afterBrowse);
  const ready = deferred();
  const unsubscribe = controller.subscribe(() => { if (controller.playerStates.has('pwa:a:player')) ready.resolve(); });
  const guard = setTimeout(() => ready.reject(new Error('PWA player state did not refresh')), 1000);
  t.after(() => { clearTimeout(guard); unsubscribe(); });
  controller.selectPlayer('pwa:a:player');
  await ready.promise;
  const afterSelection = calls.length;
  assert.equal(controller.canPlayItem(page.items[0]), true);
  assert.deepEqual(probes, ['audio/x-native-codec', 'audio/wav']);
  assert.equal(calls.length, afterSelection);
  setHandle(() => info('a', { capabilities: { playback: true, effects: true, sharing: false } }));
  controller.applyState(await api.networkMusicDiscover());
  const afterSharingStopped = calls.length;
  assert.equal(controller.canPlayItem(page.items[0]), false);
  controller.selectPlayer('local');
  assert.equal(controller.canPlayItem(page.items[1]), false);
  assert.equal(calls.length, afterSharingStopped);
  assert.equal(controller.state.libraries.length, 0);
});

test('PWA pairing accepts explicit HTTPS hostnames and keeps media on the registered origin', () => {
  assert.deepEqual(parsePwaPairingLink(`${originA}/?t=token-123`), { origin: originA, token: 'token-123' });
  assert.equal(parsePwaPairingLink('wss://192.168.1.21:47300/?t=token-123').origin, originB);
  assert.equal(parsePwaPairingLink('https://music.example.com/?t=token-123').origin, 'https://music.example.com');
  assert.equal(parsePwaPairingLink('https://music.example.com:47300/?t=token-123').origin, 'https://music.example.com:47300');
  for (const link of ['http://music.example.com:47300/?t=token-123', 'https://8.8.8.8/?t=token-123', `${originA}/evil?t=token-123`, `${originA}/?t=token-123#x`,
    'http://user:password@192.168.1.20:47300/?t=token-123', `${originA}/?t=first&t=second`, 'file:///remote.html?t=token-123']) {
    assert.throws(() => parsePwaPairingLink(link), { code: 'invalidPairingLink' });
  }
  assert.equal(validatePwaMediaUrl(media, originA), media);
  for (const value of [media.replace(originA, originB), `${media}?t=token-123`, `${originA}/other/audio`, 'https://example.com/pwa/v1/media/abcdefghijklmnop']) {
    assert.throws(() => validatePwaMediaUrl(value, originA), { code: 'invalidMediaSource' });
  }
});

test('registration persists stable identity, refreshes capabilities and sends no startup commands', async () => {
  const { api, options, calls, setHandle } = fixture();
  const added = await api.register(`${originA}/?t=token-123`);
  assert.equal(added.persistent, true);
  const state = await api.networkMusicGetState();
  assert.notEqual(state.players[0].id, state.libraries[0].id);
  const restored = new PwaNetworkMusicTransport(options);
  assert.equal((await restored.networkMusicGetState()).players[0].available, false);
  await restored.networkMusicDiscover();
  assert.equal((await restored.networkMusicGetState()).libraries[0].searchSupported, true);
  assert.ok(calls.every(call => call.url.pathname === '/pwa/v1/info' && call.init.method === 'GET'));
  assert.ok(calls.every(call => call.init.redirect === 'error' && call.init.credentials === 'omit' && call.init.headers.Authorization === 'Bearer token-123'));
  setHandle(() => info('different'));
  await assert.rejects(api.register(`${originB}/?t=new-token`, 'a'), { code: 'differentDevice' });
  assert.equal(api.records.get('a').origin, originA);
  setHandle(() => info('a', { capabilities: { playback: true, effects: true, sharing: false } }));
  await api.networkMusicDiscover();
  assert.equal((await api.networkMusicGetState()).libraries.length, 0);
  api.dispose(); restored.dispose();
});

test('PWA gateway devices keep source and target identities separate and never inherit effects access', async t => {
  const { api, calls, setHandle } = fixture();
  t.after(() => api.dispose());
  const gateway = info('a', { capabilities: { playback: true, effects: true, sharing: false },
    libraries: [{ id: 'dlna-library', name: 'NAS', available: true, searchSupported: true }],
    players: [{ id: 'dlna-player', name: 'Speakers', available: true, isEffeTune: true }] });
  setHandle(url => url.pathname.endsWith('/info') ? gateway : url.pathname.endsWith('/browse')
    ? { items: [{ id: 'song', title: 'Music' }] } : url.pathname.endsWith('/resolve')
      ? { uri: media, title: 'Music' } : { queue: [], protocolInfo: 'http-get:*:audio/flac:*' });
  await api.register(`${originA}/?t=token-123`);
  const state = await api.networkMusicGetState();
  assert.equal(state.libraries.length, 1, 'a gateway source does not require local folder sharing');
  assert.equal(state.players.find(player => player.id === 'pwa:a:player').capabilities.effects, true);
  const library = state.libraries[0], player = state.players.find(item => item.name.startsWith('Speakers'));
  assert.equal(player.isEffeTune, false);
  const page = await api.networkMusicBrowse({ serverId: library.id, objectId: '0' });
  assert.equal(page.items[0].serverId, library.id);
  assert.equal(JSON.parse(calls.at(-1).init.body).serverId, 'dlna-library');
  await api.networkMusicGetPlayerState({ playerId: player.id });
  assert.equal(calls.at(-1).url.searchParams.get('playerId'), 'dlna-player');
  await api.networkMusicPlayerCommand({ playerId: player.id, action: 'replace', items: [{ serverId: library.id, trackId: 'song' }] });
  const resolution = calls.findLast(call => call.url.pathname.endsWith('/resolve'));
  assert.deepEqual(JSON.parse(resolution.init.body).target, { origin: originA, hostId: 'a', playerId: 'dlna-player', protocolInfo: 'http-get:*:audio/flac:*' });
  assert.equal(JSON.parse(calls.at(-1).init.body).playerId, 'dlna-player');
  await assert.rejects(api.connectEffects(player.id), { code: 'unavailable' });
  assert.equal((await api.remoteClient.getConnection(player.id)).registered, false);
  gateway.libraries = [];
  gateway.capabilities.effects = false;
  await api.networkMusicDiscover();
  assert.equal((await api.networkMusicGetState()).players[0].capabilities.effects, false);
  await assert.rejects(api.networkMusicBrowse({ serverId: library.id }), { code: 'unavailable' });
});

test('restricted storage allows session use and removal without claiming persistence', async () => {
  const api = new PwaNetworkMusicTransport({ windowRef: null, storage: { getItem() { throw Error(); }, setItem() { throw Error(); } }, fetchImpl: async () => response(info()) });
  assert.equal((await api.register(`${originA}/?t=token-123`)).persistent, false);
  assert.equal(api.registrations.length, 1);
  assert.equal(api.remove('a').persistent, false);
  assert.equal(api.registrations.length, 0);
  api.dispose();
});

test('expired authorization disables operations without an automatic credential retry loop', async () => {
  let expired = false;
  let requests = 0;
  const api = new PwaNetworkMusicTransport({ windowRef: null, fetchImpl: async () => { requests++; return response(info(), expired ? 401 : 200); } });
  await api.register(`${originA}/?t=token-123`);
  expired = true;
  await assert.rejects(api.networkMusicGetPlayerState({ playerId: 'pwa:a:player' }), { code: 'registrationExpired' });
  const count = requests;
  await api.networkMusicDiscover();
  await assert.rejects(api.networkMusicPlayerCommand({ playerId: 'pwa:a:player', action: 'play' }), { code: 'registrationExpired' });
  assert.equal(requests, count);
  assert.equal((await api.networkMusicGetState()).players[0].available, false);
  api.dispose();
});

test('revoked gateway permission refreshes capabilities without expiring the paired host', async t => {
  let commands = 0;
  const api = new PwaNetworkMusicTransport({ windowRef: null, fetchImpl: async (_url, init) => {
    if (init.method === 'POST') { commands++; return response({ error: { code: 'forbidden' } }, 403); }
    return response(info());
  } });
  t.after(() => api.dispose());
  await api.register(`${originA}/?t=token-123`);
  await assert.rejects(api.networkMusicPlayerCommand({ playerId: 'pwa:a:player', action: 'mute', value: true }), { code: 'forbidden' });
  assert.equal(api.records.get('a').authorizationRequired, undefined);
  assert.equal(api.records.get('a').available, true);
  assert.equal(commands, 1);
});

test('A to B sends only resolved music to B and cancels a delayed operation after target changes', async () => {
  const { api, calls, setHandle } = fixture();
  await api.register(`${originA}/?t=token-A`);
  await api.register(`${originB}/?t=token-B`);
  let release;
  let delayed = false;
  setHandle(async url => {
    if (url.pathname === '/pwa/v1/resolve') {
      if (delayed) await new Promise(resolve => { release = resolve; });
      return { uri: `${originA}/music/read-only-grant`, metadata: '<DIDL-Lite/>', title: 'Song' };
    }
    return { queue: [], capabilities: {} };
  });
  const request = { playerId: 'pwa:b:player', action: 'replace', items: [{ serverId: 'pwa:a:library', trackId: 'track-a' }], play: true };
  await api.networkMusicPlayerCommand(request);
  const destination = calls.at(-1);
  assert.equal(destination.url.origin, originB);
  assert.equal(destination.init.headers.Authorization, 'Bearer token-B');
  assert.ok(!destination.init.body.includes('token-A'));
  assert.equal(JSON.parse(destination.init.body).tracks[0].uri, `${originA}/music/read-only-grant`);
  delayed = true;
  let current = true;
  const pending = api.networkMusicPlayerCommand({ ...request, isCurrent: () => current });
  await Promise.resolve(); current = false; release();
  assert.deepEqual(await pending, { accepted: false });
  assert.equal(calls.at(-1).url.pathname, '/pwa/v1/resolve');
  await assert.rejects(api.networkMusicPlaySelection(), { code: 'libraryRequired' });
  api.dispose();
});

test('same-host catalog playback sends one compact command for 4096 tracks', async t => {
  const { api, calls, setHandle } = fixture();
  t.after(() => api.dispose());
  setHandle(() => ({ ...info(), capabilities: { ...info().capabilities, catalogPlayback: true } }));
  await api.register(`${originA}/?t=token-A`);
  calls.length = 0;
  setHandle(() => ({}));
  const items = Array.from({ length: 4096 }, (_, index) => ({ serverId: 'pwa:a:library', trackId: `track:${index}` }));
  await api.networkMusicPlayerCommand({ playerId: 'pwa:a:player', action: 'replace', items, play: true, startIndex: 2048 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/pwa/v1/player');
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: 'replace', play: true, startIndex: 2048,
    playerId: 'native-player-a', items: items.map(({ trackId }) => ({ trackId })) });
});

test('a full remote queue resolves with bounded HTTP concurrency and preserves the clicked index', async t => {
  const { api, calls, setHandle } = fixture();
  t.after(() => api.dispose());
  await api.register(`${originA}/?t=token-A`);
  let active = 0, peak = 0;
  setHandle(async (url, init) => {
    if (url.pathname !== '/pwa/v1/resolve') return {};
    active++;
    peak = Math.max(peak, active);
    try {
      assert.ok(active <= 4, 'large queues must not exhaust browser HTTP resources');
      await new Promise(resolve => setImmediate(resolve));
      const { trackId } = JSON.parse(init.body);
      return { uri: `${originA}/music/${trackId}`, title: trackId };
    } finally { active--; }
  });
  const items = Array.from({ length: 4096 }, (_, index) => ({ serverId: 'pwa:a:library', trackId: `track-${index}` }));
  await api.networkMusicPlayerCommand({ playerId: 'pwa:a:player', action: 'replace', items, play: true, startIndex: 2048 });
  assert.equal(peak, 4);
  const command = JSON.parse(calls.at(-1).init.body);
  assert.equal(command.startIndex, 2048);
  assert.deepEqual(command.tracks.map(track => track.title), items.map(item => item.trackId));
});

test('cancelled or failed remote queue resolution stops scheduling more tracks and never changes the player', async t => {
  for (const failure of [false, true]) {
    const { api, calls, setHandle } = fixture();
    t.after(() => api.dispose());
    await api.register(`${originA}/?t=token-A`);
    let current = true;
    setHandle(async url => {
      assert.equal(url.pathname, '/pwa/v1/resolve');
      await new Promise(resolve => setImmediate(resolve));
      if (failure) throw new Error('offline');
      current = false;
      return { uri: `${originA}/music/track` };
    });
    const pending = api.networkMusicPlayerCommand({ playerId: 'pwa:a:player', action: 'replace',
      items: Array.from({ length: 100 }, (_, index) => ({ serverId: 'pwa:a:library', trackId: `track-${index}` })),
      isCurrent: () => current });
    if (failure) await assert.rejects(pending);
    else assert.deepEqual(await pending, { accepted: false });
    assert.equal(calls.filter(call => call.url.pathname === '/pwa/v1/resolve').length, 4);
    assert.equal(calls.filter(call => call.url.pathname === '/pwa/v1/player').length, 0);
  }
});

test('PWA providers preserve shared references and stream through the existing media policy without materializing bytes', async () => {
  const requests = [];
  const track = createPwaPlaybackTrack({ networkMusicResolveTrack: async request => { requests.push(request); return { uri: media, title: 'Song', playable: true }; } },
    { serverId: 'pwa:a:library', trackId: 'shared-track', title: 'Song' });
  const first = await track.provider();
  const second = await track.provider();
  assert.deepEqual(track.meta.networkLibrary, { serverId: 'pwa:a:library', trackId: 'shared-track' });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], { serverId: 'pwa:a:library', trackId: 'shared-track', localPlayback: true });
  assert.equal(first.mediaSource, second.mediaSource);
  assert.equal(first.readBytes, undefined);
  assert.equal(choosePlaybackMode(normalizePlaybackSourceDescriptor(first)).mode, 'media');
  const order = [];
  const element = { set crossOrigin(value) { order.push(['cors', value]); }, set src(value) { order.push(['src', value]); }, removeAttribute: name => order.push(['remove', name]) };
  const manager = { openHomeCorsElements: new WeakSet() };
  AudioContextManager.prototype.setAudioElementSource.call(manager, element, media);
  AudioContextManager.prototype.setAudioElementSource.call(manager, element, 'blob:local-file');
  assert.deepEqual(order, [['cors', 'anonymous'], ['src', media], ['remove', 'crossorigin'], ['src', 'blob:local-file']]);
});

test('browsed mixed-format tracks resolve the browser-supported resource through the playback provider', async t => {
  const require = createRequire(import.meta.url);
  const { PwaNetworkHost } = require('../../electron/pwa-network-host.cjs');
  const { supportsProtocol } = require('../../electron/network-music-host.cjs');
  const resources = [
    { uri: 'http://nas.example/song.aiff', protocolInfo: 'http-get:*:audio/aiff:*' },
    { uri: 'http://nas.example/song.mp3', protocolInfo: 'http-get:*:audio/mpeg:*' }
  ];
  const item = { id: 'song', trackId: 'song', title: 'Song', playable: true, resources };
  const music = Object.assign(new EventEmitter(), { id: 'a', sharing: {}, gatewayPermissions: { libraries: true },
    discovery: { devices: new Map([['nas', { available: true }]]) }, resolveTrack: async () => item, supportsProtocol });
  const host = new PwaNetworkHost({ music, remote: { token: 'token-123', listening: true, endpointOrigin: () => originA }, player: {} });
  const { api, setHandle } = fixture();
  t.after(() => { api.dispose(); host.dispose(); });
  api.windowRef = { document: { removeEventListener() {}, createElement: () => ({ canPlayType: type => type === 'audio/mpeg' ? 'probably' : '' }) }, removeEventListener() {} };
  setHandle((url, init) => url.pathname.endsWith('/info') ? info('a', { libraries: [{ id: 'nas', available: true }] }) :
    url.pathname.endsWith('/browse') ? { items: [host.browserGatewayTrack('nas', item, {})] } : host.gatewayTrack(JSON.parse(init.body), {}));
  await api.register(`${originA}/?t=token-123`);
  const state = await api.networkMusicGetState();
  const serverId = state.libraries.find(library => library.id.endsWith(':nas')).id;
  const page = await api.networkMusicBrowse({ serverId });
  assert.equal(api.canPlayItem(page.items[0], 'local'), true);
  const playback = await createPwaPlaybackTrack(api, page.items[0]).provider();
  assert.equal(host.grants.get(playback.mediaSource.split('/').at(-1)).track.uri, resources[1].uri);
  const queued = await host.gatewayTrack({ serverId: 'nas', trackId: 'song', audience: 'player', target: { hostId: 'destination-gateway', playerId: 'uuid:destination-player' } }, {});
  assert.ok(queued.uri.split('/').at(-1).length > 128);
  assert.equal(validatePwaMediaUrl(queued.uri, originA), queued.uri);
  assert.equal(validatePwaMediaUrl(queued.uri.replace('/media/', '/artwork/'), originA), queued.uri.replace('/media/', '/artwork/'));
  assert.throws(() => validatePwaMediaUrl(`${originA}/pwa/v1/media/${'a'.repeat(8193)}`, originA), { code: 'invalidMediaSource' });
  api.audioProbe = { canPlayType: () => '' };
  assert.equal(api.canPlayItem(page.items[0], 'local'), false);
  await assert.rejects(createPwaPlaybackTrack(api, page.items[0]).provider(), { code: 'unsupportedFormat' });
});

test('PWA local playback preserves initial This Device selections and begins resume before source work', async () => {
  const order = [];
  const controller = new NetworkMusicController({ api: { isPwa: true, playLocalItems: request => { order.push('provider'); return request.isCurrent(); } },
    uiManager: { beginPlaybackSelectionGestureResume: () => order.push('resume') } });
  assert.equal(controller.selectedLibraryId, 'local');
  assert.equal(controller.selectedPlayerId, 'local');
  assert.equal(await controller.playItems([{ serverId: 'pwa:a:library', trackId: 'track' }]), true);
  assert.deepEqual(order, ['resume', 'provider']);
  controller.dispose();
});
