import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { convertPresetToLongFormat } from '../../js/utils/serialization-utils.js';
import {
  packageSummary,
  runDocsGenerator
} from './generate-docs.mjs';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sourceRoot, '..', '..');
const docsRoot = path.join(sourceRoot, 'docs');
const snippetsRoot = path.join(docsRoot, 'snippets');
const fixturesRoot = path.join(docsRoot, 'fixtures');

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8'
  });
  if (result.status !== (options.status ?? 0)) {
    throw new Error(
      `${command} ${args.join(' ')} returned ${result.status}.\n` +
      `${result.stdout}${result.stderr}`
    );
  }
  return result;
}

function runPython(python, snippet, env = {}, cwd = repoRoot) {
  return run(python, [path.join(snippetsRoot, snippet)], { cwd, env });
}

function runPythonCli(python, args, options = {}) {
  return run(python, ['-m', 'effetune', ...args], options);
}

function runNpmSnippet(npmRoot, snippet, env = {}, args = []) {
  const temporary = path.join(
    npmRoot,
    `.docs-acceptance-${process.pid}-${path.basename(snippet)}`
  );
  fs.mkdirSync(temporary);
  const target = path.join(temporary, path.basename(snippet));
  fs.copyFileSync(path.join(snippetsRoot, snippet), target);
  const assetFixtures = path.join(snippetsRoot, 'asset-fixtures.mjs');
  fs.copyFileSync(assetFixtures, path.join(temporary, 'asset-fixtures.mjs'));
  try {
    run(process.execPath, [target, ...args], { cwd: npmRoot, env });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function readmeSnippet(descriptor, sources) {
  const source = fs.readFileSync(path.join(repoRoot, descriptor.output), 'utf8');
  const begin = `<!-- BEGIN ${descriptor.marker} -->`;
  const end = `<!-- END ${descriptor.marker} -->`;
  assert.equal(source.split(begin).length, 2, descriptor.output);
  assert.equal(source.split(end).length, 2, descriptor.output);
  const block = source.slice(
    source.indexOf(begin) + begin.length,
    source.indexOf(end)
  ).trim();
  const canonical = descriptor.summary
    ? packageSummary(sources, descriptor.summary)
    : fs.readFileSync(path.join(
        snippetsRoot, descriptor.snippet
      ), 'utf8').trimEnd();
  if (descriptor.summary) {
    assert.equal(block, canonical, descriptor.output);
    return null;
  }
  if (descriptor.language === 'markdown') {
    assert.equal(block, canonical, descriptor.output);
    return null;
  }
  if (descriptor.install) {
    assert.match(
      block,
      new RegExp(
        '```console\\n' +
        descriptor.install.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '\\n```'
      ),
      descriptor.output
    );
  }
  const codeBlocks = [...block.matchAll(/```([^\n]*)\n([\s\S]*?)\n```/g)];
  const match = codeBlocks.find(entry => entry[1] === descriptor.language);
  assert.ok(match, descriptor.output);
  assert.equal(match[2], canonical, descriptor.output);
  return canonical;
}

function verifyReadmeBlocks(python, npmRoot) {
  const routes = JSON.parse(fs.readFileSync(path.join(
    docsRoot, 'routes-v0.1.json'
  ), 'utf8'));
  const { sources } = runDocsGenerator({ check: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-docs-readme-'));
  try {
    for (const descriptor of routes.nonRouteOutputs) {
      const snippet = readmeSnippet(descriptor, sources);
      if (descriptor.language === 'python') {
        const filePath = path.join(temporary, `${descriptor.id}.py`);
        fs.writeFileSync(filePath, `${snippet}\n`, 'utf8');
        run(python, [filePath]);
      } else if (descriptor.language === 'js') {
        const filePath = path.join(
          npmRoot, `.docs-readme-${process.pid}-${descriptor.id}.mjs`
        );
        fs.writeFileSync(filePath, `${snippet}\n`, 'utf8');
        try {
          run(process.execPath, [filePath], { cwd: npmRoot });
        } finally {
          fs.rmSync(filePath, { force: true });
        }
      }
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function verifyJavascriptReadme(npmRoot) {
  const routes = JSON.parse(fs.readFileSync(path.join(
    docsRoot, 'routes-v0.1.json'
  ), 'utf8'));
  const { sources } = runDocsGenerator({ check: true });
  for (const descriptor of routes.nonRouteOutputs.filter(
    entry => entry.summary ||
      entry.language === 'markdown' ||
      entry.language === 'js'
  )) {
    const snippet = readmeSnippet(descriptor, sources);
    if (descriptor.language !== 'js') continue;
    const filePath = path.join(
      npmRoot, `.docs-readme-${process.pid}-${descriptor.id}.mjs`
    );
    fs.writeFileSync(filePath, `${snippet}\n`, 'utf8');
    try {
      run(process.execPath, [filePath], { cwd: npmRoot });
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  }
}

function pcm16Wave(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let offset = 12;
  let format;
  let samples;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ') {
      format = {
        encoding: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        bits: bytes.readUInt16LE(start + 14)
      };
    } else if (id === 'data') {
      samples = new Int16Array(
        bytes.buffer.slice(
          bytes.byteOffset + start,
          bytes.byteOffset + start + length
        )
      );
    }
    offset = start + length + (length % 2);
  }
  assert.deepEqual(format, {
    encoding: 1,
    channels: 2,
    sampleRate: 48000,
    bits: 16
  });
  assert.equal(samples.length, 4096 * 2);
  return samples;
}

export async function verifyWorklet(npmRoot) {
  const packageRoot = fs.existsSync(path.join(
    npmRoot, 'node_modules', '@effetune', 'dsp', 'dist', 'worklet.js'
  ))
    ? path.join(npmRoot, 'node_modules', '@effetune', 'dsp')
    : npmRoot;
  const packageDist = path.join(packageRoot, 'dist');
  const secureOrigin = 'https://effetune.test';
  const serviceWorkerResources = {};
  function collectServiceWorkerResources(directory = packageDist) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        collectServiceWorkerResources(entryPath);
      } else if (entry.isFile() &&
          ['.js', '.json', '.wasm'].includes(path.extname(entry.name))) {
        const relative = path.relative(packageDist, entryPath).replaceAll('\\', '/');
        const resource = {
          body: fs.readFileSync(entryPath).toString('base64'),
          type: path.extname(entry.name) === '.wasm'
            ? 'application/wasm'
            : path.extname(entry.name) === '.json'
              ? 'application/json'
              : 'text/javascript'
        };
        serviceWorkerResources[`/package/${relative}`] = resource;
      }
    }
  }
  collectServiceWorkerResources();
  const serviceWorker = `
const resources = ${JSON.stringify(serviceWorkerResources)};
function decode(encoded) {
  const binary = atob(encoded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  let pathname = new URL(event.request.url).pathname;
  for (const prefix of [
    '/vendor/@effetune/dsp/dist/',
    '/demo/vendor/@effetune/dsp/'
  ]) {
    if (pathname.startsWith(prefix)) {
      pathname = '/package/' + pathname.slice(prefix.length);
      break;
    }
  }
  const resource = resources[pathname];
  if (!resource) return;
  event.respondWith(new Response(decode(resource.body), {
    status: 200,
    headers: { 'Content-Type': resource.type }
  }));
});`;
  const html = `<!doctype html>
<body>
<button id="numeric" type="button">Run numeric acceptance</button>
<script type="importmap">
{"imports":{"@effetune/dsp":"${secureOrigin}/package/index.js","@effetune/dsp/worklet":"${secureOrigin}/package/worklet.js"}}
</script>
<script type="module">
import { createVolumeGraph } from './audioworklet-start.mjs';
import { getEffectCatalog } from '@effetune/dsp';
import { EffeTuneNode } from '@effetune/dsp/worklet';
import { assetSetup } from './asset-fixtures.mjs';
document.querySelector('#numeric').addEventListener('click', async () => {
 try {
  const secure = isSecureContext;
  const userActivated = navigator.userActivation.isActive;
  const windowFrames = 4096;
  const frames = windowFrames * 2;
  const context = new OfflineAudioContext(2, frames, 48000);
  const buffer = context.createBuffer(2, frames, 48000);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame += 1) {
      data[frame] = 0.5 * Math.sin(2 * Math.PI * frame / 97);
    }
  }
  const source = new AudioBufferSourceNode(context, { buffer });
  const graph = await createVolumeGraph(context, source, context.destination, {
    variant: 'baseline'
  });
  const firstSuspension = context.suspend(windowFrames / 48000);
  source.start();
  const rendering = context.startRendering();
  await firstSuspension;
  const update = graph.setVolume(-12);
  await Promise.resolve();
  await Promise.all([context.resume(), update]);
  const rendered = await rendering;
  let maximumError = 0;
  let initialPeak = 0;
  let updatedPeak = 0;
  const windowErrors = { initial: 0, updated: 0 };
  const boundaryGuard = 256;
  for (let channel = 0; channel < 2; channel += 1) {
    const actual = rendered.getChannelData(channel);
    const input = buffer.getChannelData(channel);
    for (let frame = 0; frame < windowFrames - boundaryGuard; frame += 1) {
      const expected = input[frame] * 10 ** (-6 / 20);
      const error = Math.abs(actual[frame] - expected);
      maximumError = Math.max(maximumError, error);
      windowErrors.initial = Math.max(windowErrors.initial, error);
      initialPeak = Math.max(initialPeak, Math.abs(actual[frame]));
    }
    for (let frame = windowFrames + boundaryGuard; frame < frames; frame += 1) {
      const expected = input[frame] * 10 ** (-12 / 20);
      const error = Math.abs(actual[frame] - expected);
      maximumError = Math.max(maximumError, error);
      windowErrors.updated = Math.max(windowErrors.updated, error);
      updatedPeak = Math.max(updatedPeak, Math.abs(actual[frame]));
    }
  }

  const resetFrames = 2048;
  const resetContext = new OfflineAudioContext(2, resetFrames, 48000);
  const resetBuffer = resetContext.createBuffer(2, resetFrames, 48000);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = resetBuffer.getChannelData(channel);
    for (let frame = 0; frame < resetFrames; frame += 1) {
      data[frame] = 0.5 * Math.sin(2 * Math.PI * frame / 97);
    }
  }
  const resetSource = new AudioBufferSourceNode(resetContext, {
    buffer: resetBuffer
  });
  const resetNode = await EffeTuneNode.create(resetContext, {
    version: 1,
    chain: [{
      id: 'volume',
      type: 'Volume',
      parameters: { volume: -12 }
    }]
  }, { channels: 2, seed: 0, variant: 'baseline' });
  resetSource.connect(resetNode).connect(resetContext.destination);
  const resetSuspension = resetContext.suspend(1024 / 48000);
  resetSource.start();
  const resetRendering = resetContext.startRendering();
  await resetSuspension;
  const reset = resetNode.reset();
  await Promise.resolve();
  await Promise.all([resetContext.resume(), reset]);
  const resetRendered = await resetRendering;
  let resetMaximumError = 0;
  for (let channel = 0; channel < 2; channel += 1) {
    const actual = resetRendered.getChannelData(channel);
    const input = resetBuffer.getChannelData(channel);
    for (let frame = 0; frame < resetFrames; frame += 1) {
      if (Math.abs(frame - 1024) < boundaryGuard) continue;
      const expected = input[frame] * 10 ** (-12 / 20);
      resetMaximumError = Math.max(
        resetMaximumError,
        Math.abs(actual[frame] - expected)
      );
    }
  }
  resetSource.disconnect();
  resetNode.close();

  const telemetryFrames = 8192;
  const telemetryContext = new OfflineAudioContext(2, telemetryFrames, 48000);
  const telemetryBuffer = telemetryContext.createBuffer(2, telemetryFrames, 48000);
  for (let frame = 0; frame < telemetryFrames; frame += 1) {
    telemetryBuffer.getChannelData(0)[frame] =
      Math.sin(2 * Math.PI * 997 * frame / 48000);
    telemetryBuffer.getChannelData(1)[frame] =
      0.5 * Math.sin(2 * Math.PI * 1499 * frame / 48000);
  }
  const telemetrySource = new AudioBufferSourceNode(telemetryContext, {
    buffer: telemetryBuffer
  });
  const telemetryNode = await EffeTuneNode.create(telemetryContext, {
    version: 1,
    chain: [{
      id: 'meter',
      type: 'LevelMeter',
      parameters: {}
    }]
  }, { channels: 2, seed: 0, variant: 'baseline' });
  const telemetryReceived = [];
  let resolveTelemetry;
  const telemetryObserved = new Promise(resolve => {
    resolveTelemetry = resolve;
  });
  const unsubscribeTelemetry = telemetryNode.subscribe(frame => {
    telemetryReceived.push(frame);
    resolveTelemetry();
  });
  telemetrySource.connect(telemetryNode).connect(telemetryContext.destination);
  telemetrySource.start();
  const telemetryRendering = telemetryContext.startRendering();
  await Promise.race([
    telemetryObserved,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('AudioWorklet telemetry callback timed out.')),
      5000
    ))
  ]);
  const telemetryFrame = telemetryReceived.find(frame => frame.kind === 'level');
  const telemetryUnsubscribed = unsubscribeTelemetry();
  await telemetryRendering;
  telemetrySource.disconnect();
  telemetryNode.close();

  async function renderConvolution(effect, variant, irVariant) {
    const setup = assetSetup(effect, 48000, irVariant);
    const convolutionFrames = 4096;
    const convolutionContext = new OfflineAudioContext(
      setup.channels,
      convolutionFrames,
      48000
    );
    const convolutionBuffer = convolutionContext.createBuffer(
      setup.channels,
      convolutionFrames,
      48000
    );
    convolutionBuffer.getChannelData(0)[0] = 0.5;
    convolutionBuffer.getChannelData(1)[0] = -0.25;
    const convolutionSource = new AudioBufferSourceNode(convolutionContext, {
      buffer: convolutionBuffer
    });
    const convolutionNode = await EffeTuneNode.create(convolutionContext, {
      version: 1,
      chain: [{
        id: effect.type,
        type: effect.type,
        parameters: setup.parameters,
        assets: setup.references
      }]
    }, {
      channels: setup.channels,
      seed: 0,
      variant,
      assetResolver: setup.assetResolver
    });
    convolutionSource.connect(convolutionNode).connect(
      convolutionContext.destination
    );
    convolutionSource.start();
    const convolutionRendered = await convolutionContext.startRendering();
    const output = Array.from(
      { length: setup.channels },
      (_, channel) => Float32Array.from(
        convolutionRendered.getChannelData(channel)
      )
    );
    convolutionSource.disconnect();
    convolutionNode.close();
    return output;
  }

  const convolution = [];
  const convolutionEffects = getEffectCatalog().effects.filter(
    effect => effect.assets.length
  );
  for (const variant of ['baseline', 'simd']) {
    for (const effect of convolutionEffects) {
      const first = await renderConvolution(effect, variant, 'a');
      const second = await renderConvolution(effect, variant, 'b');
      let finite = true;
      let peak = 0;
      let maximumDifference = 0;
      for (let channel = 0; channel < first.length; channel += 1) {
        for (let frame = 0; frame < first[channel].length; frame += 1) {
          finite = finite &&
            Number.isFinite(first[channel][frame]) &&
            Number.isFinite(second[channel][frame]);
          peak = Math.max(
            peak,
            Math.abs(first[channel][frame]),
            Math.abs(second[channel][frame])
          );
          maximumDifference = Math.max(
            maximumDifference,
            Math.abs(first[channel][frame] - second[channel][frame])
          );
        }
      }
      convolution.push({
        effect: effect.type,
        variant,
        finite,
        peak,
        maximumDifference
      });
    }
  }

  await graph.close();
  let closedRejected = false;
  try {
    await graph.setVolume(-3);
  } catch {
    closedRejected = true;
  }
  window.__docsResult = {
    secure,
    userActivated,
    closedRejected,
    maximumError,
    windowErrors,
    peaks: { initialPeak, updatedPeak },
    windowDifference: initialPeak - updatedPeak,
    resetMaximumError,
    telemetry: {
      received: telemetryReceived.length,
      unsubscribed: telemetryUnsubscribed,
      effectId: telemetryFrame?.effectId,
      channels: telemetryFrame?.channels.length,
      leftPeak: telemetryFrame?.channels[0].peak
    },
    convolution
  };
 } catch (error) {
  window.__docsResult = { error: error?.stack || String(error) };
 }
});
</script>`;
  const canonicalHtml = `<!doctype html>
<script type="importmap">
{"imports":{"@effetune/dsp":"${secureOrigin}/package/index.js"}}
</script>
<script type="module">
import('./javascript-start.mjs').then(
  () => { window.__canonicalStartResult = { ok: true }; },
  error => {
    window.__canonicalStartResult = {
      ok: false,
      error: error?.stack || String(error)
    };
  }
);
</script>`;

  function localPath(root, relative, label) {
    const resolved = path.resolve(root, ...relative.split('/'));
    const relation = path.relative(root, resolved);
    if (!relative || relation === '..' || relation.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relation)) {
      throw new Error(`Unsafe ${label} request path: ${relative}`);
    }
    return resolved;
  }

  function contentType(filePath) {
    const extension = path.extname(filePath);
    if (extension === '.html') return 'text/html';
    if (extension === '.css') return 'text/css';
    if (extension === '.js' || extension === '.mjs') return 'text/javascript';
    if (extension === '.json') return 'application/json';
    if (extension === '.wasm') return 'application/wasm';
    return 'application/octet-stream';
  }

  async function installRoutes(page, pages) {
    await page.route(`${secureOrigin}/**`, async route => {
      const pathname = new URL(route.request().url()).pathname;
      let filePath;
      let body;
      let responseContentType;
      if (pages.has(pathname)) {
        const value = pages.get(pathname);
        if (typeof value === 'object') {
          body = value.body;
          responseContentType = value.contentType;
        } else if (value.startsWith('<!doctype')) {
          body = value;
        } else {
          filePath = value;
        }
      } else if (pathname.startsWith('/package/')) {
        filePath = localPath(
          packageDist,
          pathname.slice('/package/'.length),
          'package'
        );
      } else if (pathname.startsWith('/vendor/@effetune/dsp/dist/')) {
        filePath = localPath(
          packageDist,
          pathname.slice('/vendor/@effetune/dsp/dist/'.length),
          'public package'
        );
      } else if (pathname.startsWith('/demo/vendor/@effetune/dsp/')) {
        filePath = localPath(
          packageDist,
          pathname.slice('/demo/vendor/@effetune/dsp/'.length),
          'demo package'
        );
      }
      if (body !== undefined) {
        await route.fulfill({
          status: 200,
          body,
          contentType: responseContentType ?? 'text/html'
        });
      } else if (filePath && fs.existsSync(filePath) &&
          fs.statSync(filePath).isFile()) {
        await route.fulfill({
          status: 200,
          body: fs.readFileSync(filePath),
          contentType: contentType(filePath)
        });
      } else {
        await route.abort('blockedbyclient');
      }
    });
  }

  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await installRoutes(context, new Map([
      ['/prepare/', '<!doctype html><title>Prepare secure origin</title>'],
      ['/start/', path.join(
        snippetsRoot, 'audioworklet-bootstrap.html'
      )],
      ['/start/audioworklet-start.js', path.join(
        snippetsRoot, 'audioworklet-start.js'
      )],
      ['/numeric/', html],
      ['/numeric/audioworklet-start.mjs', path.join(
        snippetsRoot, 'audioworklet-start.js'
      )],
      ['/numeric/asset-fixtures.mjs', path.join(
        snippetsRoot, 'asset-fixtures.mjs'
      )],
      ['/canonical/', canonicalHtml],
      ['/canonical/javascript-start.mjs', path.join(
        snippetsRoot, 'javascript-start.mjs'
      )],
      ['/sw.js', {
        body: serviceWorker,
        contentType: 'text/javascript'
      }],
      ['/demo/', path.join(sourceRoot, 'index.html')],
      ['/demo/app.js', path.join(sourceRoot, 'app.js')],
      ['/demo/styles.css', path.join(sourceRoot, 'styles.css')]
    ]));
    const prepare = await context.newPage();
    await prepare.goto(`${secureOrigin}/prepare/`);
    assert.equal(await prepare.evaluate(() => isSecureContext), true);
    await prepare.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
    });
    if (!await prepare.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
      await prepare.reload();
    }
    await prepare.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    const start = await context.newPage();
    await start.goto(`${secureOrigin}/start/`);
    assert.equal(await start.evaluate(() => isSecureContext), true);
    assert.equal(
      await start.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      true
    );
    await start.evaluate(() => {
      window.__startError = null;
      window.addEventListener('unhandledrejection', event => {
        window.__startError = event.reason?.stack || String(event.reason);
      }, { once: true });
    });
    await start.getByRole('button', { name: 'Start', exact: true }).click();
    await start.waitForFunction(() => {
      const buttons = [...document.querySelectorAll('button')];
      return window.__startError ||
        buttons.some(button => button.textContent === 'Stop' && !button.disabled);
    });
    const startError = await start.evaluate(() => window.__startError);
    assert.ok(!startError, startError);
    await start.getByRole('button', { name: 'Stop', exact: true }).click();
    await start.waitForFunction(() => {
      const buttons = [...document.querySelectorAll('button')];
      return buttons.some(button => button.textContent === 'Start' && !button.disabled);
    });

    const numeric = await context.newPage();
    await numeric.goto(`${secureOrigin}/numeric/`);
    assert.equal(await numeric.evaluate(() => isSecureContext), true);
    await numeric.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await numeric.locator('#numeric').click();
    await numeric.waitForFunction(() => window.__docsResult, null, {
      timeout: 120000
    });
    const result = await numeric.evaluate(() => window.__docsResult);
    assert.ok(!result.error, result.error);
    assert.equal(result.secure, true);
    assert.equal(result.userActivated, true);
    assert.equal(result.closedRejected, true);
    assert.ok(
      result.maximumError <= 1e-6 + 1e-5 * 0.5,
      JSON.stringify(result)
    );
    assert.ok(result.windowDifference >= 0.1, result.windowDifference);
    assert.ok(
      result.resetMaximumError <= 1e-6 + 1e-5 * 0.5,
      result.resetMaximumError
    );
    assert.ok(result.telemetry.received > 0, JSON.stringify(result.telemetry));
    assert.equal(result.telemetry.unsubscribed, true);
    assert.equal(result.telemetry.effectId, 'meter');
    assert.equal(result.telemetry.channels, 2);
    assert.ok(result.telemetry.leftPeak > 0.9);
    assert.equal(result.convolution.length, 12);
    for (const entry of result.convolution) {
      assert.equal(entry.finite, true, JSON.stringify(entry));
      assert.ok(entry.peak > 1e-7, JSON.stringify(entry));
      assert.ok(entry.maximumDifference > 1e-5, JSON.stringify(entry));
    }

    const canonical = await context.newPage();
    await canonical.goto(`${secureOrigin}/canonical/`);
    assert.equal(await canonical.evaluate(() => isSecureContext), true);
    await canonical.waitForFunction(() => window.__canonicalStartResult, null, {
      timeout: 30000
    });
    const canonicalResult = await canonical.evaluate(
      () => window.__canonicalStartResult
    );
    assert.equal(canonicalResult.ok, true, canonicalResult.error);

    const demo = await context.newPage();
    await demo.goto(`${secureOrigin}/demo/`);
    assert.equal(await demo.evaluate(() => isSecureContext), true);
    await demo.evaluate(() => {
      document.querySelector('#start').addEventListener('click', () => {
        window.__demoGesture = navigator.userActivation.isActive;
      }, { capture: true, once: true });
    });
    await demo.locator('#start').click();
    await demo.waitForFunction(() =>
      document.querySelector('#status').textContent.includes(
        'Playing through the EffeTune DSP AudioWorklet.'
      )
    );
    assert.equal(await demo.evaluate(() => window.__demoGesture), true);
    await demo.locator('#bypass').click();
    await demo.waitForFunction(() =>
      document.querySelector('#bypass').ariaPressed === 'true' &&
      document.querySelector('#status').textContent.includes('Bypass is on.')
    );
    await demo.locator('#stop').click();
    await demo.waitForFunction(() =>
      document.querySelector('#status').textContent.includes('Playback stopped.') &&
      !document.querySelector('#start').disabled &&
      document.querySelector('#bypass').disabled &&
      document.querySelector('#stop').disabled
    );
  } finally {
    if (browser) await browser.close();
  }
}

function verifyVisualFixture(python) {
  const inputPath = path.join(fixturesRoot, 'visual-editor-input-v0.1.json');
  const goldenPath = path.join(fixturesRoot, 'visual-editor-golden-v0.1.json');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  const nativeNow = Date.now;
  Date.now = () => 1710000000000;
  try {
    assert.deepEqual(convertPresetToLongFormat(input), golden);
  } finally {
    Date.now = nativeNow;
  }
  runPython(python, 'visual-editor-to-code.py', {
    DSP_VISUAL_GOLDEN: goldenPath
  });
}

function verifyCli(python) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-docs-cli-'));
  try {
    runPython(python, 'cli-start.py', {}, temporary);
    runPythonCli(python, ['chain', 'validate', 'volume.json'], { cwd: temporary });
    runPythonCli(python, [
      'render',
      'input.wav',
      'output.wav',
      '--preset',
      'volume.json'
    ], { cwd: temporary });
    runPythonCli(python, ['preset', 'inspect', 'volume.json'], { cwd: temporary });
    const inputSamples = pcm16Wave(path.join(temporary, 'input.wav'));
    const outputSamples = pcm16Wave(path.join(temporary, 'output.wav'));
    const gain = 10 ** (-6 / 20);
    for (let index = 0; index < inputSamples.length; index += 1) {
      const expected = inputSamples[index] / 32768 * gain;
      const actual = outputSamples[index] / 32768;
      assert.ok(Math.abs(actual - expected) <= 2 / 32768 + 1e-6);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  const batchTemporary = fs.mkdtempSync(path.join(
    os.tmpdir(), 'effetune-docs-batch-'
  ));
  try {
    const batch = run(
      python,
      [path.join(snippetsRoot, 'batch-render.py')],
      { cwd: batchTemporary }
    );
    assert.match(`${batch.stdout}${batch.stderr}`, /invalid\.wav: render failed/);
    const batchOutputs = path.join(batchTemporary, 'batch-demo', 'outputs');
    assert.deepEqual(fs.readdirSync(batchOutputs).sort(), [
      'first.wav',
      'second.wav'
    ]);
  } finally {
    fs.rmSync(batchTemporary, { recursive: true, force: true });
  }
}

function verifyBundleInterop(python, npmRoot) {
  const temporary = fs.mkdtempSync(path.join(
    os.tmpdir(), 'effetune-docs-bundle-'
  ));
  try {
    runPython(python, 'bundle-pack.py', {}, temporary);
    runPythonCli(python, [
      'bundle',
      'pack',
      'room-chain.json',
      'cli-bundle',
      '--asset',
      'room-ir=room-ir.wav'
    ], { cwd: temporary });
    const pythonManifest = fs.readFileSync(path.join(
      temporary, 'python-bundle', 'bundle.json'
    ));
    const cliManifest = fs.readFileSync(path.join(
      temporary, 'cli-bundle', 'bundle.json'
    ));
    assert.deepEqual(cliManifest, pythonManifest);
    const manifest = JSON.parse(pythonManifest);
    for (const entry of manifest.assets) {
      assert.deepEqual(
        fs.readFileSync(path.join(temporary, 'cli-bundle', entry.reference)),
        fs.readFileSync(path.join(temporary, 'python-bundle', entry.reference))
      );
    }
    runPythonCli(python, [
      'render',
      'input.wav',
      'bundle-output.wav',
      '--preset',
      'cli-bundle',
      '--subtype',
      'FLOAT'
    ], { cwd: temporary });
    assert.ok(fs.statSync(path.join(temporary, 'bundle-output.wav')).size > 44);
    runNpmSnippet(npmRoot, 'bundle-interop.mjs', {}, [
      path.join(temporary, 'python-bundle')
    ]);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function verifyCrossLanguageContract(python, npmRoot) {
  const temporary = fs.mkdtempSync(path.join(
    os.tmpdir(), 'effetune-docs-cross-language-'
  ));
  try {
    const contract = path.join(temporary, 'python-contract.json');
    runPython(python, 'cross-language-contract.py', {}, temporary);
    runNpmSnippet(npmRoot, 'cross-language-contract.mjs', {}, [contract]);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export async function verifyDocsAcceptance({
  python = 'python',
  npmRoot,
  wheel
}) {
  if (!npmRoot) throw new Error('--npm-root is required.');
  runPython(python, 'python-start.py');
  runPython(python, 'ml-data-augmentation.py');
  runPython(python, 'asset-required-examples.py');
  verifyReadmeBlocks(python, npmRoot);
  verifyVisualFixture(python);
  verifyBundleInterop(python, npmRoot);
  verifyCrossLanguageContract(python, npmRoot);
  verifyCli(python);
  if (!wheel) throw new Error('--wheel is required for the research acceptance.');
  const research = run(python, [
    path.join(snippetsRoot, 'research-experiment.py'),
    '--wheel',
    path.resolve(wheel)
  ]);
  const record = JSON.parse(research.stdout);
  assert.equal(record.artifact.filename, path.basename(wheel));
  assert.match(record.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(record.experiment.effect, 'SimpleJitter');
  assert.equal(record.experiment.processingMode, 'stream');
  assert.deepEqual(record.experiment.executionSeeds, { same: 0, different: 1 });
  assert.match(record.input.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(record.input.shape, [
    record.experiment.channels,
    record.experiment.frames
  ]);
  assert.deepEqual(
    record.runs.map(run => run.label),
    ['first', 'repeat', 'variant']
  );
  for (const run of record.runs) {
    assert.equal(run.mode, 'stream');
    assert.equal(run.operations[0].operation, 'open');
    assert.equal(run.operations.at(-1).operation, 'close');
    let nextFrame = 0;
    for (const operation of run.operations.slice(1, -1)) {
      assert.equal(operation.operation, 'process');
      assert.equal(operation.startFrame, nextFrame);
      assert.ok(operation.endFrame > operation.startFrame);
      nextFrame = operation.endFrame;
    }
    assert.equal(nextFrame, record.experiment.frames);
  }
  assert.notEqual(
    record.outputs.first,
    record.outputs.variant
  );
  assert.equal(record.outputs.first, record.outputs.repeat);
  const replayRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'effetune-docs-research-replay-'
  ));
  try {
    const recordPath = path.join(replayRoot, 'record.json');
    fs.writeFileSync(recordPath, `${JSON.stringify(record)}\n`, 'utf8');
    const replay = run(python, [
      path.join(snippetsRoot, 'research-experiment.py'),
      '--wheel',
      path.resolve(wheel),
      '--replay-record',
      recordPath
    ]);
    assert.deepEqual(JSON.parse(replay.stdout), {
      inputSha256: record.input.sha256,
      outputs: record.outputs
    });
  } finally {
    fs.rmSync(replayRoot, { recursive: true, force: true });
  }
  await verifyJavascriptAcceptance(npmRoot);
}

export async function verifyJavascriptAcceptance(npmRoot) {
  runNpmSnippet(npmRoot, 'javascript-start.mjs');
  verifyJavascriptReadme(npmRoot);
  runNpmSnippet(npmRoot, 'asset-required-examples.mjs');
  runNpmSnippet(
    npmRoot,
    'verify-source-generation.mjs',
    {},
    [
      path.join(fixturesRoot, 'source-generation-v0.1.json'),
      path.join(repoRoot, 'docs', 'dsp', 'catalog', 'effects-v1.json'),
      path.join(docsRoot, 'effects-v1.docs.json')
    ]
  );
  await verifyWorklet(npmRoot);
}

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const npmRoot = option('--npm-root');
    if (process.argv.includes('--javascript-only')) {
      if (!npmRoot) throw new Error('--npm-root is required.');
      await verifyJavascriptAcceptance(npmRoot);
    } else {
      await verifyDocsAcceptance({
        python: option('--python', 'python'),
        npmRoot,
        wheel: option('--wheel')
      });
    }
    console.log('Verified runnable DSP documentation against candidate packages.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
