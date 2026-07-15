import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const host = '127.0.0.1';
const args = parseArguments(process.argv.slice(2));
const timeoutMs = args.mode === 'contract' ? 5 * 60_000 : 12 * 60 * 60_000;
const execFileAsync = promisify(execFile);
const GIBIBYTE = 1024 ** 3;
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm']
]);

async function main() {
  const { chromium } = await importPlaywright();
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Web SQLite test server address is unavailable');
  let browser;
  let memorySampler;
  try {
    browser = await chromium.launch({
      headless: process.env.LIBRARY_SQLITE_HEADED !== '1'
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', message => {
      const line = `[browser:${message.type()}] ${message.text()}\n`;
      if (message.type() === 'error' || message.type() === 'warning') process.stderr.write(line);
      else process.stdout.write(line);
    });
    page.on('pageerror', error => process.stderr.write(`${error.stack || error.message}\n`));
    await page.goto(
      `http://${host}:${address.port}/tests/browser/library-sqlite-harness.html`,
      { waitUntil: 'load' }
    );
    await page.waitForFunction(() => Boolean(globalThis.__librarySqlite));
    if (args.mode === 'scale') {
      memorySampler = await createBrowserMemorySampler(browser);
      await page.exposeFunction('__librarySqliteFinishWorkloadMemory', () => memorySampler.finishWorkload());
    }
    const result = await withTimeout(
      page.evaluate(async options => options.mode === 'contract'
        ? globalThis.__librarySqlite.runContract()
        : globalThis.__librarySqlite.runScale({ size: options.size }), args),
      timeoutMs,
      `Web SQLite ${args.mode} verification exceeded ${timeoutMs} ms`
    );
    if (args.mode === 'scale') {
      const memory = await memorySampler.stop();
      result.metrics.peakMemoryBytes = memory.peakResidentBytes;
      result.metrics.peakPrivateMemoryBytes = memory.peakPrivateBytes;
      result.metrics.peakMemoryBreakdown = memory.peakResidentBreakdown;
      result.metrics.peakNonBrowserMemoryBytes = memory.peakNonBrowserBytes;
      result.metrics.finalMemoryBytes = memory.finalResidentBytes;
      result.metrics.finalPrivateMemoryBytes = memory.finalPrivateBytes;
      result.metrics.finalMemoryBreakdown = memory.finalResidentBreakdown;
      result.metrics.runtimeHeapBytes = result.metrics.wasmMemoryBytes + result.metrics.rendererJsHeapBytes;
      result.metrics.memorySampleCount = memory.sampleCount;
      if (result.metrics.runtimeHeapBytes >= 512 * 1024 ** 2) {
        throw new Error(`SQLite WASM and renderer heap ${(result.metrics.runtimeHeapBytes / GIBIBYTE).toFixed(2)} GiB must be below 0.5 GiB`);
      }
      if (memory.peakNonBrowserBytes >= GIBIBYTE) {
        throw new Error(`Peak UI and Worker memory ${(memory.peakNonBrowserBytes / GIBIBYTE).toFixed(2)} GiB must be below 1 GiB`);
      }
      if (memory.peakResidentBytes >= 4 * GIBIBYTE) {
        throw new Error(`Peak Chromium memory ${(memory.peakResidentBytes / GIBIBYTE).toFixed(2)} GiB must be below 4 GiB`);
      }
    }
    process.stdout.write(`${JSON.stringify({ mode: args.mode, ...result }, null, 2)}\n`);
    await context.close();
  } finally {
    await memorySampler?.stop().catch(() => {});
    await browser?.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
}

async function createBrowserMemorySampler(browser) {
  const session = await browser.newBrowserCDPSession();
  let peakResidentBytes = 0;
  let peakPrivateBytes = 0;
  let peakNonBrowserBytes = 0;
  let peakResidentBreakdown = {};
  let lastMemory = null;
  let sampleCount = 0;
  let samplePromise = null;
  let stopped = false;
  let stopResult = null;
  let workloadResult = null;

  const sample = async () => {
    if (samplePromise) return samplePromise;
    samplePromise = (async () => {
      const { processInfo } = await session.send('SystemInfo.getProcessInfo');
      const processTypes = new Map(processInfo.map(info => [Number(info.id), info.type]));
      const processMemory = await readProcessMemory([...processTypes.keys()]);
      const residentBytes = processMemory.reduce((total, row) => total + row.residentBytes, 0);
      const privateBytes = processMemory.reduce((total, row) => total + row.privateBytes, 0);
      const nonBrowserBytes = processMemory.reduce((total, row) => (
        processTypes.get(row.id) === 'browser' ? total : total + row.residentBytes
      ), 0);
      if (!Number.isFinite(residentBytes) || residentBytes <= 0) {
        throw new Error('Browser process memory could not be measured');
      }
      const residentBreakdown = Object.fromEntries(Object.entries(processMemory.reduce((totals, row) => {
        const type = processTypes.get(row.id) ?? 'unknown';
        totals[type] = (totals[type] ?? 0) + row.residentBytes;
        return totals;
      }, {})).sort(([left], [right]) => left.localeCompare(right)));
      lastMemory = { residentBytes, privateBytes, residentBreakdown };
      peakPrivateBytes = Math.max(peakPrivateBytes, privateBytes);
      peakNonBrowserBytes = Math.max(peakNonBrowserBytes, nonBrowserBytes);
      if (residentBytes > peakResidentBytes) {
        peakResidentBytes = residentBytes;
        peakResidentBreakdown = residentBreakdown;
      }
      sampleCount += 1;
    })().finally(() => {
      samplePromise = null;
    });
    return samplePromise;
  };

  await sample();
  const timer = setInterval(() => {
    sample().catch(error => process.stderr.write(`Browser memory sample failed: ${error.message}\n`));
  }, 10_000);

  return {
    async finishWorkload() {
      if (workloadResult) return workloadResult;
      clearInterval(timer);
      await samplePromise?.catch(() => {});
      await sample();
      const finalMemory = lastMemory;
      workloadResult = {
        peakResidentBytes,
        peakPrivateBytes,
        peakNonBrowserBytes,
        peakResidentBreakdown,
        finalResidentBytes: finalMemory.residentBytes,
        finalPrivateBytes: finalMemory.privateBytes,
        finalResidentBreakdown: finalMemory.residentBreakdown,
        sampleCount
      };
      return workloadResult;
    },
    async stop() {
      if (stopResult) return stopResult;
      if (!stopped) {
        stopped = true;
        await this.finishWorkload();
        await session.detach().catch(() => {});
        stopResult = workloadResult;
      }
      return stopResult;
    }
  };
}

async function readProcessMemory(processIds) {
  const ids = [...new Set(processIds)].filter(id => id > 0);
  if (ids.length === 0) return [];
  if (process.platform === 'win32') {
    const script = [
      `$ids = @(${ids.join(',')})`,
      "Get-Process -Id $ids -ErrorAction SilentlyContinue | ForEach-Object { '{0},{1},{2}' -f $_.Id,$_.WorkingSet64,$_.PrivateMemorySize64 }"
    ].join('; ');
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script
    ], { windowsHide: true });
    return stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
      const [id, residentBytes, privateBytes] = line.split(',').map(Number);
      return { id, residentBytes, privateBytes };
    });
  }
  if (process.platform === 'linux') {
    const rows = [];
    for (const id of ids) {
      try {
        const status = await fs.promises.readFile(`/proc/${id}/status`, 'utf8');
        const residentMatch = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
        const privateMatch = status.match(/^RssAnon:\s+(\d+)\s+kB$/m);
        if (residentMatch) rows.push({
          id,
          residentBytes: Number(residentMatch[1]) * 1024,
          privateBytes: Number(privateMatch?.[1] ?? 0) * 1024
        });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return rows;
  }
  const { stdout } = await execFileAsync('ps', ['-o', 'pid=,rss=', '-p', ids.join(',')]);
  return stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [id, residentKilobytes] = line.trim().split(/\s+/).map(Number);
    return { id, residentBytes: residentKilobytes * 1024, privateBytes: 0 };
  });
}

function createStaticServer() {
  return http.createServer((request, response) => {
    let requestPath;
    try {
      requestPath = decodeURIComponent(new URL(request.url ?? '/', `http://${host}`).pathname);
    } catch {
      sendText(response, 400, 'Bad request');
      return;
    }
    const relativePath = requestPath.replace(/^\/+/, '');
    const absolutePath = path.resolve(root, relativePath);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
      sendText(response, 403, 'Forbidden');
      return;
    }
    let stats;
    try {
      stats = fs.statSync(absolutePath);
    } catch {
      sendText(response, 404, 'Not found');
      return;
    }
    if (!stats.isFile()) {
      sendText(response, 404, 'Not found');
      return;
    }
    response.statusCode = 200;
    setHeaders(response, contentTypes.get(path.extname(absolutePath).toLowerCase()) ?? 'application/octet-stream');
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = fs.createReadStream(absolutePath);
    stream.on('error', error => response.destroy(error));
    stream.pipe(response);
  });
}

function setHeaders(response, contentType) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function sendText(response, statusCode, text) {
  response.statusCode = statusCode;
  setHeaders(response, 'text/plain; charset=utf-8');
  response.end(text);
}

function parseArguments(values) {
  if (values.length === 1 && values[0] === '--contract') return { mode: 'contract', size: 0 };
  if (values.length === 2 && values[0] === '--size') {
    const size = Number(values[1]);
    if (Number.isSafeInteger(size) && size > 0) return { mode: 'scale', size };
  }
  throw new Error('Usage: node tools/library-scale/run-web-sqlite.mjs --contract | --size 1000000');
}

async function importPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new Error('Playwright is required. Run npm install and npx playwright install chromium.', { cause: error });
  }
}

function withTimeout(promise, duration, message) {
  let timeoutId;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), duration);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
