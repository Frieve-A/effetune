import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findPackagedApplications } from './verify-dsp-package.mjs';
import { verifyRollingPcmPackage } from './verify-rolling-pcm-package.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const host = '127.0.0.1';
const fixturePath = '/__rolling-pcm-distribution-smoke__/index.html';
const startupTimeoutMs = 20_000;
const probeTimeoutMs = 20_000;
const cleanupTimeoutMs = 8_000;
const fixtureHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' blob: data:; script-src 'self' https://www.googletagmanager.com 'unsafe-inline' 'unsafe-eval' blob:; connect-src 'self' blob: https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com; img-src 'self' https://www.google-analytics.com https://*.google-analytics.com data: blob:; media-src 'self' blob: data: http://127.0.0.1:*; style-src 'self' 'unsafe-inline' blob:;">
  <title>EffeTune rolling PCM distribution smoke</title>
</head>
<body>Rolling PCM distribution smoke</body>
</html>`;
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm']
]);

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function startStaticServer() {
  const sockets = new Set();
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
      if (pathname === fixturePath) {
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/html; charset=utf-8'
        });
        response.end(fixtureHtml);
        return;
      }
      const filePath = path.resolve(repoRoot, `.${pathname}`);
      if (!filePath.startsWith(`${repoRoot}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const body = await fsPromises.readFile(filePath);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': contentTypes.get(path.extname(filePath)) || 'application/octet-stream'
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await withTimeout(new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  }), startupTimeoutMs, 'Rolling PCM static server startup');
  return {
    baseUrl: `http://${host}:${server.address().port}`,
    async close() {
      const closing = new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      for (const socket of sockets) socket.destroy();
      await withTimeout(closing, cleanupTimeoutMs, 'Rolling PCM static server shutdown');
    }
  };
}

async function probeProductionTransport(transportUrl) {
  const { RollingPcmTransport } = await import(transportUrl);
  const sampleRate = 48_000;
  const frameCount = 128;
  const channelCount = 2;
  const bytesPerSample = 2;
  const dataBytes = frameCount * channelCount * bytesPerSample;
  const wav = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(wav);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  const context = new AudioContext({ sampleRate });
  const transport = new RollingPcmTransport(context);
  const workerUrl = String(transport.workerUrl);
  try {
    const blob = new Blob([wav], { type: 'audio/wav' });
    const metadata = await transport.prepare({
      sourceKind: 'blob',
      blob,
      byteLength: blob.size
    }, { minimumHeadFrames: 1 });
    return {
      protocolResponse: 'ready',
      workerUrl,
      sampleRate: metadata.sampleRate,
      channelCount: metadata.channelCount,
      totalFrames: metadata.totalFrames
    };
  } finally {
    await transport.dispose();
    await context.close();
  }
}

async function installAndActivateServiceWorker(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none'
    });
    const worker = registration.installing || registration.waiting || registration.active;
    if (!worker) throw new Error('Service worker registration returned no worker');
    if (worker.state !== 'activated') {
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          worker.removeEventListener('statechange', onStateChange);
          reject(new Error('Timed out waiting for the production service worker to activate'));
        }, 15_000);
        function onStateChange() {
          if (worker.state === 'redundant') {
            clearTimeout(timeoutId);
            worker.removeEventListener('statechange', onStateChange);
            reject(new Error('Production service worker became redundant'));
          } else if (worker.state === 'activated') {
            clearTimeout(timeoutId);
            worker.removeEventListener('statechange', onStateChange);
            resolve();
          }
        }
        worker.addEventListener('statechange', onStateChange);
      });
    }
    await navigator.serviceWorker.ready;
    return worker.scriptURL;
  });
}

async function inspectPrecache(page) {
  return page.evaluate(async () => {
    const precacheSource = await fetch('/sw-precache.js', { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error(`sw-precache.js returned ${response.status}`);
      return response.text();
    });
    const cacheVersion = precacheSource.match(
      /EFFECTUNE_CACHE_VERSION\s*=\s*["']([^"']+)["']/
    )?.[1] || null;
    const urls = [
      '/js/ui/audio-player/rolling-pcm-transport.js',
      '/js/vendor/rolling-pcm-decoder-worker.mjs',
      '/js/vendor/rolling-pcm-decoder-worker.NOTICE.txt'
    ].map(relative => new URL(relative, location.href));
    const cacheNames = await caches.keys();
    const matches = [];
    for (const url of urls) {
      let found = false;
      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        if (await cache.match(url)) {
          found = true;
          break;
        }
      }
      matches.push({ url: url.href, found });
    }
    return {
      controllerUrl: navigator.serviceWorker.controller?.scriptURL || null,
      cacheVersion,
      cacheNames,
      matches
    };
  });
}

async function closeBrowserContext(context) {
  if (!context) return;
  try {
    await withTimeout(context.close(), cleanupTimeoutMs, 'Chromium shutdown');
  } catch (error) {
    const browser = context.browser();
    if (browser?.isConnected()) await withTimeout(browser.close(), cleanupTimeoutMs, 'Chromium forced shutdown');
    throw error;
  }
}

async function runPwaSmoke(chromium, tempRoot) {
  const server = await startStaticServer();
  let context = null;
  let result = null;
  let smokeError = null;
  try {
    const userDataDir = path.join(tempRoot, 'chromium-user-data');
    context = await withTimeout(chromium.launchPersistentContext(userDataDir, {
      headless: true,
      serviceWorkers: 'allow',
      timeout: startupTimeoutMs
    }), startupTimeoutMs, 'Chromium startup');
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${server.baseUrl}${fixturePath}`, { waitUntil: 'domcontentloaded' });
    const serviceWorkerUrl = await withTimeout(
      installAndActivateServiceWorker(page),
      probeTimeoutMs,
      'PWA service worker activation'
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js'),
      undefined,
      { timeout: startupTimeoutMs }
    );
    const precache = await withTimeout(inspectPrecache(page), probeTimeoutMs, 'PWA precache inspection');
    assert.ok(precache.controllerUrl?.endsWith('/sw.js'), 'Production service worker must control the PWA smoke page');
    assert.ok(precache.cacheVersion, 'Generated precache must declare a cache version');
    assert.ok(
      precache.cacheNames.includes(precache.cacheVersion),
      'Production precache must create its declared cache version'
    );
    assert.ok(precache.matches.every(match => match.found), 'Production precache must contain transport, Worker, and NOTICE');
    const transportUrl = new URL('/js/ui/audio-player/rolling-pcm-transport.js', server.baseUrl).href;
    const protocol = await withTimeout(
      page.evaluate(probeProductionTransport, transportUrl),
      probeTimeoutMs,
      'PWA rolling PCM Worker protocol'
    );
    assert.equal(protocol.protocolResponse, 'ready');
    assert.equal(new URL(protocol.workerUrl).pathname, '/js/vendor/rolling-pcm-decoder-worker.mjs');
    result = { serviceWorkerUrl, precache, protocol };
  } catch (error) {
    smokeError = error;
  }
  let cleanupError = null;
  try {
    await closeBrowserContext(context);
  } catch (error) {
    cleanupError = error;
  }
  try {
    await server.close();
  } catch (error) {
    cleanupError ||= error;
  }
  if (smokeError) throw smokeError;
  if (cleanupError) throw cleanupError;
  return result;
}

function findPackagedExecutable(application) {
  const resourcesDirectory = path.dirname(application.path);
  const applicationDirectory = path.dirname(resourcesDirectory);
  if (process.platform === 'win32') {
    const exact = path.join(applicationDirectory, `${packageJson.build.productName}.exe`);
    if (fs.existsSync(exact)) return exact;
    const candidates = fs.readdirSync(applicationDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.exe') &&
        !entry.name.toLowerCase().includes('uninstall'))
      .map(entry => path.join(applicationDirectory, entry.name));
    return candidates.length === 1 ? candidates[0] : null;
  }
  if (process.platform === 'darwin') {
    const executableDirectory = path.join(applicationDirectory, 'MacOS');
    if (!fs.existsSync(executableDirectory)) return null;
    const exact = path.join(executableDirectory, packageJson.build.productName);
    if (fs.existsSync(exact)) return exact;
    const candidates = fs.readdirSync(executableDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.join(executableDirectory, entry.name));
    return candidates.length === 1 ? candidates[0] : null;
  }
  const exact = path.join(applicationDirectory, packageJson.build.linux.executableName);
  if (fs.existsSync(exact)) return exact;
  const candidates = fs.readdirSync(applicationDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.join(applicationDirectory, entry.name))
    .filter(candidate => (fs.statSync(candidate).mode & 0o111) !== 0);
  return candidates.length === 1 ? candidates[0] : null;
}

async function findMainWindow(electronApplication) {
  await electronApplication.firstWindow({ timeout: startupTimeoutMs });
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    const page = electronApplication.windows().find(candidate => {
      try {
        return new URL(candidate.url()).pathname.endsWith('/effetune.html');
      } catch {
        return false;
      }
    });
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the packaged EffeTune renderer');
}

async function closeElectronApplication(electronApplication) {
  if (!electronApplication) return;
  const child = electronApplication.process();
  try {
    await withTimeout(electronApplication.close(), cleanupTimeoutMs, 'Packaged Electron shutdown');
  } catch (error) {
    const exit = child.exitCode === null
      ? new Promise(resolve => child.once('exit', resolve))
      : Promise.resolve();
    if (child.exitCode === null) child.kill();
    try {
      await withTimeout(exit, cleanupTimeoutMs,
        'Packaged Electron forced shutdown');
    } catch {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    throw error;
  }
}

async function runPackagedElectronSmoke(electron, application, tempRoot, index) {
  const executablePath = findPackagedExecutable(application);
  assert.ok(executablePath, `${application.path}: no packaged executable was found for ${process.platform}`);
  assert.equal(
    fs.existsSync(path.join(path.dirname(executablePath), 'effetune_settings')),
    false,
    `${application.path}: packaged smoke will not use or modify an existing portable settings directory`
  );
  const userDataDir = path.join(tempRoot, `electron-user-data-${index}`);
  await fsPromises.mkdir(userDataDir, { recursive: true });
  await fsPromises.writeFile(path.join(userDataDir, 'config.json'), JSON.stringify({
    startMinimized: true,
    minimizeToTray: false,
    checkForUpdatesOnStartup: false,
    openHomeRemoteControl: false
  }));
  let electronApplication = null;
  try {
    electronApplication = await withTimeout(electron.launch({
      executablePath,
      args: [`--user-data-dir=${userDataDir}`, '--from-auto-restart'],
      timeout: startupTimeoutMs,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      }
    }), startupTimeoutMs, `Packaged Electron startup for ${application.path}`);
    const actualUserDataDir = await electronApplication.evaluate(({ app }) => app.getPath('userData'));
    assert.equal(
      fs.realpathSync(actualUserDataDir),
      fs.realpathSync(userDataDir),
      `${application.path}: packaged Electron must use the runner-owned user-data directory`
    );
    const page = await findMainWindow(electronApplication);
    await page.waitForLoadState('domcontentloaded');
    const transportUrl = await page.evaluate(() => new URL(
      './js/ui/audio-player/rolling-pcm-transport.js',
      location.href
    ).href);
    const protocol = await withTimeout(
      page.evaluate(probeProductionTransport, transportUrl),
      probeTimeoutMs,
      `Packaged Electron rolling PCM Worker protocol for ${application.path}`
    );
    assert.equal(protocol.protocolResponse, 'ready');
    assert.equal(
      new URL(protocol.workerUrl).pathname.endsWith('/js/vendor/rolling-pcm-decoder-worker.mjs'),
      true,
      `${application.path}: packaged transport must construct the production Worker URL`
    );
    return { application: application.path, executablePath, protocol };
  } finally {
    await closeElectronApplication(electronApplication);
  }
}

async function main() {
  const packageRoot = path.resolve(process.argv[2] || 'dist');
  const applications = findPackagedApplications(packageRoot);
  verifyRollingPcmPackage(packageRoot);
  const tempRoot = await fsPromises.realpath(await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'effetune-rolling-distribution-')
  ));
  try {
    const { chromium, _electron: electron } = await import('playwright');
    const pwa = await runPwaSmoke(chromium, tempRoot);
    const packagedElectron = [];
    for (let index = 0; index < applications.length; index++) {
      packagedElectron.push(await runPackagedElectronSmoke(
        electron,
        applications[index],
        tempRoot,
        index
      ));
    }
    console.log(JSON.stringify({
      packageRoot,
      pwa,
      packagedElectron
    }, null, 2));
  } finally {
    await withTimeout(fsPromises.rm(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    }), cleanupTimeoutMs, 'Rolling PCM smoke temporary directory cleanup');
  }
}

await main();
