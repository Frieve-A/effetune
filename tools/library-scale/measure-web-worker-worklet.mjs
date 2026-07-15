import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const host = '127.0.0.1';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error('Invalid Web reference arguments');
    result[name.slice(2)] = value;
  }
  return result;
}

function createServer() {
  return http.createServer((request, response) => {
    let relativePath;
    try {
      relativePath = decodeURIComponent(new URL(request.url || '/', `http://${host}`).pathname)
        .replace(/^\/+/, '');
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }
    const absolutePath = path.resolve(root, relativePath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    let stats;
    try {
      stats = fs.statSync(absolutePath);
    } catch {
      response.writeHead(404).end('Not found');
      return;
    }
    if (!stats.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    const extension = path.extname(absolutePath).toLowerCase();
    const contentType = extension === '.html' ? 'text/html; charset=utf-8'
      : ['.js', '.mjs'].includes(extension) ? 'text/javascript; charset=utf-8'
        : extension === '.json' ? 'application/json; charset=utf-8'
          : extension === '.wasm' ? 'application/wasm' : 'application/octet-stream';
    response.setHeader('Content-Type', contentType);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    fs.createReadStream(absolutePath).pipe(response);
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const options = {
    count: Number(args.count),
    seed: Number(args.seed),
    digest: args.digest,
    samples: Number(args.samples),
    audioWorkletSeconds: Number(args['audio-seconds'])
  };
  if (!path.isAbsolute(args.output) || !Number.isSafeInteger(options.count) || options.count <= 0 ||
      !Number.isSafeInteger(options.seed) || !Number.isSafeInteger(options.samples) || options.samples < 1 ||
      !Number.isFinite(options.audioWorkletSeconds) || options.audioWorkletSeconds < 1) {
    throw new Error('Web reference measurement arguments are invalid');
  }
  const { chromium } = await import('playwright');
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  let browser;
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Reference server address is unavailable');
    browser = await chromium.launch({
      headless: process.env.LIBRARY_SCALE_HEADED !== '1',
      args: ['--autoplay-policy=no-user-gesture-required']
    });
    const page = await browser.newPage();
    page.on('console', message => process.stderr.write(`[reference-browser:${message.type()}] ${message.text()}\n`));
    page.on('pageerror', error => process.stderr.write(`${error.stack || error.message}\n`));
    await page.goto(
      `http://${host}:${address.port}/tools/library-scale/reference-browser-harness.html`,
      { waitUntil: 'load' }
    );
    await page.waitForFunction(() => typeof globalThis.__runEffeTuneReferenceMeasurement === 'function');
    const result = await page.evaluate(
      browserOptions => globalThis.__runEffeTuneReferenceMeasurement(browserOptions),
      options
    );
    fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } finally {
    await browser?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
