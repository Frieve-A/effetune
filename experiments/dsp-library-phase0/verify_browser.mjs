import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.f32', 'application/octet-stream'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm']
]);

function safePath(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  const resolved = path.resolve(repositoryRoot, `.${pathname}`);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function createServer() {
  return http.createServer(async (request, response) => {
    const filePath = safePath(request.url ?? '/');
    if (!filePath) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await fs.readFile(filePath);
      response.writeHead(200, {
        'Content-Type': contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      response.end(body);
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end();
    }
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

const server = createServer();
let browser;
try {
  const port = await listen(server);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(
    `http://127.0.0.1:${port}/experiments/dsp-library-phase0/worklet/fixture.html`
  );

  for (const [artifact, expectedSimd] of [
    ['effetune-dsp.wasm', false],
    ['effetune-dsp.simd.wasm', true]
  ]) {
    const result = await page.evaluate(selected => window.__phase0Worklet.run(selected), artifact);
    assert.equal(result.abiVersion, 1, `${artifact}: existing WASM ABI v1`);
    assert.equal(result.kernelHash, 0x2d876fa2, `${artifact}: Compressor layout hash`);
    assert.equal(result.simd, expectedSimd, `${artifact}: capability from WASM build flags`);
    assert.ok(
      result.fullWasmProcessQuanta >= result.targetRenderQuanta,
      `${artifact}: every golden frame processed by WASM`
    );
    assert.equal(result.fullJsProcessQuanta, 0, `${artifact}: no JavaScript DSP fallback`);
    assert.ok(
      result.maximumDryDifference > result.absTolerance,
      `${artifact}: golden does not distinguish Compressor processing from dry input`
    );
    assert.ok(
      result.maximumError <= result.absTolerance,
      `${artifact}: max abs error ${result.maximumError} > ${result.absTolerance}`
    );
    console.log(
      `${artifact} compressor case-003 passed: ` +
      `goldenBlockSize=${result.metadataBlockSize}, renderQuantum=${result.audioWorkletRenderQuantum}, ` +
      `targetRenderQuanta=${result.targetRenderQuanta}, wasmQuanta=${result.fullWasmProcessQuanta}, ` +
      `absTolerance=${result.absTolerance}, maxDryDifference=${result.maximumDryDifference}, ` +
      `maxAbsError=${result.maximumError}`
    );
  }
  assert.deepEqual(browserErrors, []);
} finally {
  await browser?.close();
  await close(server);
}
