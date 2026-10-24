import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createPwaNetworkFixture } from '../helpers/pwa-network-fixture.cjs';
import { createTrustedChromeProfile } from '../helpers/chrome-profile-trust.mjs';

const publicOrigin = 'https://effetune.frieve.com';
const read = file => readFile(new URL(file, import.meta.url), 'utf8');
const documentHtml = await read('../../effetune.html');
const csp = documentHtml.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
const header = documentHtml.slice(documentHtml.indexOf('    <div class="title-container">'), documentHtml.indexOf('    <div class="main-container">'));
const css = (await Promise.all(['effetune-theme.css', 'effetune.css', 'effetune-mobile.css', 'effetune-network-music.css'].map(file => read(`../../css/${file}`)))).join('\n').replace('@import url("effetune-theme.css");', '');
let volumeCode;
const volumeScope = { window: {}, PluginBase: class { registerProcessor(code) { volumeCode = code; } } };
vm.runInNewContext(`${await read('../../plugins/basics/volume.js')}\nnew VolumePlugin();`, volumeScope);
const volumeWorklet = `class VolumeProbe extends AudioWorkletProcessor {
  constructor() { super(); this.db = 0; this.context = {}; this.port.onmessage = e => { this.db = e.data.db; }; }
  process(inputs, outputs) {
    const input = inputs[0]?.[0], output = outputs[0]?.[0];
    if (!input || !output) return true;
    const data = new Float32Array(input); const parameters = { enabled:true, vl:this.db, channelCount:1, blockSize:data.length, sampleRate };
    const processed = (function(data, parameters, context) { ${volumeCode} })(data, parameters, this.context);
    output.set(processed); return true;
  }
} registerProcessor('pwa-volume-probe', VolumeProbe);`;

function wave() {
  const frames = 48000 * 8; const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(48000, 24); data.writeUInt32LE(96000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) data.writeInt16LE(Math.round(8000 * Math.sin(frame * Math.PI * 2 * 1000 / 48000)), 44 + frame * 2);
  return data;
}

const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), contents: `
  import { PwaNetworkMusicTransport } from './js/network-music/pwa-transport.js';
  import { NetworkMusicController } from './js/network-music/controller.js';
  import { NetworkMusicView } from './js/network-music/view.js';
  import { createPwaPlaybackTrack } from './js/network-music/pwa-playback-provider.js';
  import { AudioContextManager } from './js/ui/audio-player/audio-context-manager.js';
  const api = new PwaNetworkMusicTransport();
  const uiManager = { t: key => key, setError() {}, layoutMode: { isMobile: true } };
  const controller = new NetworkMusicController({ api, uiManager });
  const view = new NetworkMusicView({ controller, uiManager });
  view.mount();
  const violations = []; document.addEventListener('securitypolicyviolation', e => violations.push(e.effectiveDirective));
  window.fixture = { api, controller, view, violations,
    async register(link) { const result = await api.register(link); controller.applyState(await api.networkMusicGetState()); return result; },
    async startMedia(item) {
      const context = new AudioContext({ sampleRate:48000, sinkId:{type:'none'} });
      await context.resume();
      const moduleUrl = URL.createObjectURL(new Blob([${JSON.stringify(volumeWorklet)}], {type:'text/javascript'}));
      try { await context.audioWorklet.addModule(moduleUrl); } finally { URL.revokeObjectURL(moduleUrl); }
      const worklet = new AudioWorkletNode(context, 'pwa-volume-probe');
      const analyser = context.createAnalyser(); analyser.fftSize = 2048; worklet.connect(analyser); analyser.connect(context.destination);
      const element = new Audio(); element.loop = true;
      const player = { audioContext:context, audioElement:element, stateManager:{ getStateSnapshot:()=>({}) } };
      const connected = new Set();
      const audioManager = { audioContext:context, workletNode:worklet,
        connectSourceToPipeline(source) { if (!connected.has(source)) { source.connect(worklet); connected.add(source); } return true; },
        disconnectSourceFromPipeline(source) { if (connected.delete(source)) source.disconnect(worklet); return true; }
      };
      const manager = new AudioContextManager(player, audioManager);
      const track = createPwaPlaybackTrack(api, item); const source = await track.provider();
      manager.setAudioElementSource(element, source.mediaSource);
      if (!manager.connectToAudioContext()) throw new Error('Media source did not enter the existing pipeline');
      await element.play();
      const rms = async () => { await new Promise(resolve => setTimeout(resolve, 160)); const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data); return Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0)/data.length); };
      fixture.audio = { context, element, manager, worklet, rms, source };
      return rms();
    }
  };
` }, bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'import.meta.url': JSON.stringify(`${publicOrigin}/pwa-test.js`) } });

async function publicPage(browser, { permission = true, width = 390, pageOrigin = publicOrigin } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 780 } });
  if (permission) await context.grantPermissions(['local-network-access'], { origin: pageOrigin });
  await context.route(`${pageOrigin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/pwa-volume-worklet.js') return route.fulfill({ contentType: 'text/javascript', body: volumeWorklet });
    if (url.pathname !== '/pwa-test') return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="layout-mobile"><head>${csp}<style>${css}</style></head><body class="layout-mobile">${header}<main class="main-container"></main><script>${bundle.outputFiles[0].text}</script></body></html>` });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(`${pageOrigin}/pwa-test`);
  await page.waitForFunction(() => window.fixture);
  if (!permission) {
    const session = await context.newCDPSession(page);
    const { targetInfo } = await session.send('Target.getTargetInfo');
    await session.send('Browser.setPermission', { permission: { name: 'local-network-access' }, setting: 'denied', origin: pageOrigin, browserContextId: targetInfo.browserContextId });
    await session.detach();
  }
  return { context, page };
}

test('production CSP permits registered HTTP/WS with LNA, streaming enters Volume, denial and foreign script remain blocked', { timeout: 45000 }, async () => {
  const fixture = await createPwaNetworkFixture({ origin: publicOrigin });
  const { runtime } = await fixture.serverHost.getCatalog();
  const resolve = runtime.resolvePlaybackSource;
  const tone = path.join(fixture.directory, 'Music', 'pwa-test-tone.wav');
  await writeFile(tone, wave());
  runtime.resolvePlaybackSource = async id => ({ ...await resolve(id), path: tone });
  let browser, destination;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const { context, page } = await publicPage(browser);
    const link = `${fixture.base}/?t=pwa-test-control-token`;
    const result = await page.evaluate(link => fixture.register(link), link);
    assert.equal(result.persistent, true);
    const track = await page.evaluate(async () => {
      const state = await fixture.api.networkMusicGetState();
      return (await fixture.api.networkMusicBrowse({ serverId: state.libraries[0].id, objectId: 'view:tracks' })).items[0];
    });
    const rms = await page.evaluate(item => fixture.startMedia({ ...item, trackId: item.id }), track);
    assert.ok(rms > 0.05, `CORS/Web Audio source must be audible (${rms})`);
    const reduced = await page.evaluate(async () => { fixture.audio.worklet.port.postMessage({ db: -20 }); return fixture.audio.rms(); });
    assert.ok(reduced / rms > 0.085 && reduced / rms < 0.115, `Volume must process streamed audio (${reduced / rms})`);
    assert.equal(await page.evaluate(() => fixture.audio.element.crossOrigin), 'anonymous');
    const range = await page.evaluate(async () => {
      const response = await fetch(fixture.audio.source.mediaSource, { headers: { Range: 'bytes=44-143' } });
      return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
    });
    assert.deepEqual(range, { status: 206, bytes: 100 });
    destination = await createPwaNetworkFixture({ origin: publicOrigin });
    const destinations = await page.evaluate(async ({ link, item }) => {
      const source = (await fixture.api.networkMusicGetState()).players[0].id;
      const target = (await fixture.register(link)).playerId;
      const args = { action: 'replace', items: [{ serverId: item.serverId, trackId: item.id }], play: true, startIndex: 0 };
      await fixture.api.networkMusicPlayerCommand({ ...args, playerId: source });
      await fixture.api.networkMusicPlayerCommand({ ...args, playerId: target });
      const stateA = await fixture.api.networkMusicGetPlayerState({ playerId: source });
      const stateB = await fixture.api.networkMusicGetPlayerState({ playerId: target });
      return { stateA, stateB };
    }, { link: `${destination.base}/?t=pwa-test-control-token`, item: track });
    assert.equal(destinations.stateA.transportState, 'Playing');
    assert.equal(destinations.stateB.transportState, 'Playing');
    assert.equal(destinations.stateB.queue[0].title, track.title);
    assert.ok(!destinations.stateB.queue[0].uri.includes('/pwa/v1/'));
    const ws = await page.evaluate(async () => {
      const events = []; const off = fixture.api.remoteClient.onEvent(event => events.push(event));
      const state = await fixture.api.networkMusicGetState(); const result = await fixture.api.remoteClient.connect(state.players[0].id);
      const deadline = performance.now() + 5000;
      while (!events.some(event => event.type === 'open')) { if (performance.now() > deadline) throw Error('WS open timeout'); await new Promise(resolve => setTimeout(resolve, 20)); }
      await fixture.api.remoteClient.send(result.connectionId, JSON.stringify({ op:'hello', v:1 }));
      while (!events.some(event => event.type === 'message' && JSON.parse(event.data).op === 'state')) { if (performance.now() > deadline) throw Error('WS hello timeout'); await new Promise(resolve => setTimeout(resolve, 20)); }
      off(); await fixture.api.remoteClient.disconnect(result.connectionId); return true;
    });
    assert.equal(ws, true);
    await page.evaluate(() => { const script = document.createElement('script'); script.src = 'https://unrelated.invalid/untrusted.js'; document.head.append(script); });
    await page.waitForFunction(() => fixture.violations.includes('script-src-elem'));
    assert.equal(await page.evaluate(() => fixture.violations.includes('connect-src') || fixture.violations.includes('media-src')), false);
    await page.evaluate(async () => { fixture.audio.element.pause(); await fixture.audio.context.close(); fixture.view.dispose(); fixture.api.dispose(); });
    await context.close();
    assert.equal(destination.snapshot().transportState, 'Playing', 'closing the PWA must not stop the destination');
    const denied = await publicPage(browser, { permission: false });
    assert.equal(await denied.page.evaluate(async link => { try { await fixture.register(link); return 'accepted'; } catch (error) { return error.code; } }, link), 'connectionFailed');
    await denied.context.close();
    const foreign = await publicPage(browser, { pageOrigin: 'https://not-allowed.example' });
    assert.equal(await foreign.page.evaluate(async link => { try { await fixture.register(link); return 'accepted'; } catch (error) { return error.code; } }, link), 'connectionFailed');
    await foreign.context.close();
  } finally { await browser?.close(); await destination?.close(); await fixture.close(); }
});

test('PWA QR and paste dialog keeps mobile geometry, supports denial/fallback and stops every owned camera', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  try {
    const { context, page } = await publicPage(browser);
    await page.selectOption('.network-select', 'pwa-add-device');
    assert.equal(await page.locator('dialog').isVisible(), true);
    assert.equal(await page.locator('button', { hasText: 'Scan QR code' }).isVisible(), false);
    assert.equal(await page.locator('input[type=password]').isVisible(), true);
    const bounds = await page.locator('dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(() => {
      fixture.stopped = 0; fixture.detect = null;
      window.BarcodeDetector = class { static getSupportedFormats() { return Promise.resolve(['qr_code']); } async detect() { return fixture.detect ? [{rawValue:fixture.detect}] : []; } };
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable:true, value: async options => {
        fixture.cameraOptions = options;
        if (fixture.denyCamera) throw new DOMException('denied', 'NotAllowedError');
        const canvas = document.createElement('canvas'); const stream = canvas.captureStream(5); const track = stream.getTracks()[0];
        canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
        const stop = track.stop.bind(track); track.stop = () => { fixture.stopped++; stop(); }; return stream;
      } });
      fixture.api.register = async () => ({persistent:true});
    });
    for (const outcome of ['close', 'success', 'pagehide', 'denied']) {
      await page.evaluate(outcome => { fixture.denyCamera = outcome === 'denied'; fixture.detect = null; }, outcome);
      await page.selectOption('.network-select', 'pwa-add-device');
      await page.getByRole('button', { name: 'Scan QR code', exact:true }).click();
      if (outcome === 'denied') { await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent.includes('Could not use the camera')); }
      else {
        await page.waitForFunction(() => fixture.cameraOptions && document.querySelector('video')?.srcObject);
        if (outcome === 'success') {
          await page.evaluate(() => { fixture.detect = 'http://192.168.1.20:47300/?t=pairing-token'; });
          await page.waitForFunction(() => document.querySelector('.pwa-device-status').textContent.startsWith('Device added'));
        } else if (outcome === 'pagehide') await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      }
      if (await page.locator('dialog').count()) await page.getByRole('button', { name: 'Close', exact:true }).click();
    }
    assert.equal(await page.evaluate(() => fixture.cameraOptions.audio), false);
    assert.equal(await page.evaluate(() => fixture.stopped), 3);
    assert.equal(await page.locator('video').count(), 0);
    await context.close();
  } finally { await browser.close(); }
});

test('production CSP uses profile-trusted HTTPS/WSS and processed media while a mismatched certificate fails closed', { timeout: 60000 }, async () => {
  const parent = await realpath(os.tmpdir());
  const directory = await realpath(await mkdtemp(path.join(parent, 'effetune-pwa-browser-tls-')));
  let trusted, fixture, mismatch, context;
  try {
    const ca = path.join(directory, 'ca.pem'); const caKey = path.join(directory, 'ca.key');
    const key = path.join(directory, 'server.key'); const csr = path.join(directory, 'server.csr');
    const config = path.join(directory, 'openssl.cnf');
    await writeFile(config, '[req]\ndistinguished_name=dn\n[dn]\n');
    const openssl = args => execFileSync('openssl', args, { stdio: 'ignore' });
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', config,
      '-subj', '/CN=EffeTune PWA Browser Test CA', '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', caKey, '-out', ca]);
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-config', config, '-subj', '/CN=PWA test listener', '-keyout', key, '-out', csr]);
    const certificates = [];
    for (const [name, address] of [['matching', '127.0.0.1'], ['mismatch', '127.0.0.2']]) {
      const extensions = path.join(directory, `${name}.ext`); const certificate = path.join(directory, `${name}.pem`);
      await writeFile(extensions, `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:${address}\n`);
      openssl(['x509', '-req', '-in', csr, '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-days', '1', '-extfile', extensions, '-out', certificate]);
      certificates.push(certificate);
    }
    trusted = await createTrustedChromeProfile(ca);
    fixture = await createPwaNetworkFixture({ origin: publicOrigin, env: { EFFETUNE_REMOTE_TLS_CERT: certificates[0], EFFETUNE_REMOTE_TLS_KEY: key } });
    mismatch = await createPwaNetworkFixture({ origin: publicOrigin, env: { EFFETUNE_REMOTE_TLS_CERT: certificates[1], EFFETUNE_REMOTE_TLS_KEY: key } });
    const { runtime } = await fixture.serverHost.getCatalog(); const resolve = runtime.resolvePlaybackSource;
    const tone = path.join(fixture.directory, 'Music', 'pwa-tls-tone.wav'); await writeFile(tone, wave());
    runtime.resolvePlaybackSource = async id => ({ ...await resolve(id), path: tone });
    const opened = await publicPage(trusted.browser); context = opened.context;
    const { page } = opened; const failures = [];
    page.on('requestfailed', request => failures.push({ url: request.url(), error: request.failure()?.errorText }));
    await page.evaluate(link => fixture.register(link), `${fixture.base}/?t=pwa-test-control-token`);
    const track = await page.evaluate(async () => {
      const state = await fixture.api.networkMusicGetState();
      return (await fixture.api.networkMusicBrowse({ serverId: state.libraries[0].id, objectId: 'view:tracks' })).items[0];
    });
    const rms = await page.evaluate(item => fixture.startMedia({ ...item, trackId: item.id }), track);
    const reduced = await page.evaluate(async () => { fixture.audio.worklet.port.postMessage({ db: -20 }); return fixture.audio.rms(); });
    assert.ok(rms > 0.05 && reduced / rms > 0.085 && reduced / rms < 0.115);
    assert.ok((await page.evaluate(() => fixture.audio.source.mediaSource)).startsWith(`${fixture.base}/pwa/v1/media/`));
    const secureSocket = await page.evaluate(async () => {
      const events = []; const off = fixture.api.remoteClient.onEvent(event => events.push(event));
      const state = await fixture.api.networkMusicGetState(); const connection = await fixture.api.remoteClient.connect(state.players[0].id);
      const deadline = performance.now() + 5000;
      while (!events.some(event => event.type === 'open')) { if (performance.now() > deadline) throw Error('WSS open timeout'); await new Promise(resolve => setTimeout(resolve, 20)); }
      await fixture.api.remoteClient.send(connection.connectionId, JSON.stringify({ op: 'hello', v: 1 }));
      while (!events.some(event => event.type === 'message' && JSON.parse(event.data).op === 'state')) { if (performance.now() > deadline) throw Error('WSS state timeout'); await new Promise(resolve => setTimeout(resolve, 20)); }
      off(); await fixture.api.remoteClient.disconnect(connection.connectionId); return true;
    });
    assert.equal(secureSocket, true);
    assert.equal(await page.evaluate(async link => { try { await fixture.register(link); return 'accepted'; } catch (error) { return error.code; } }, `${mismatch.base}/?t=pwa-test-control-token`), 'connectionFailed');
    assert.ok(failures.some(request => request.url.startsWith(mismatch.base) && request.error === 'net::ERR_CERT_COMMON_NAME_INVALID'));
    assert.equal(await page.evaluate(base => new Promise(resolve => {
      const socket = new WebSocket(`${base.replace('https:', 'wss:')}/pwa/v1/effects?t=pwa-test-control-token`);
      socket.onopen = () => { socket.close(); resolve('accepted'); }; socket.onerror = () => resolve('rejected');
    }), mismatch.base), 'rejected');
    assert.equal(await page.evaluate(() => fixture.violations.includes('connect-src') || fixture.violations.includes('media-src')), false);
    await page.evaluate(async () => { fixture.audio.element.pause(); await fixture.audio.context.close(); fixture.view.dispose(); fixture.api.dispose(); });
  } finally {
    await context?.close(); await trusted?.close(); await mismatch?.close(); await fixture?.close();
    assert.equal(path.dirname(directory), parent);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
