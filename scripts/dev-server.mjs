import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildSite } from '../examples/dsp-library/build-site.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteOutputRoot = path.join(repoRoot, '_site');
const expectedGitHubPagesVersion = '232';
const defaultHost = process.env.HOST || '127.0.0.1';
const defaultPort = Number.parseInt(process.env.PORT || '8000', 10);

const mimeTypes = new Map([
  ['.aac', 'audio/aac'],
  ['.css', 'text/css; charset=utf-8'],
  ['.flac', 'audio/flac'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.json5', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.m4a', 'audio/mp4'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.wav', 'audio/wav'],
  ['.webm', 'audio/webm']
]);

function parseArgs(argv) {
  const options = {
    host: defaultHost,
    port: Number.isFinite(defaultPort) ? defaultPort : 8000
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--host' && argv[i + 1]) {
      options.host = argv[++i];
    } else if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length);
    } else if (arg === '--port' && argv[i + 1]) {
      options.port = Number.parseInt(argv[++i], 10);
    } else if (arg.startsWith('--port=')) {
      options.port = Number.parseInt(arg.slice('--port='.length), 10);
    }
  }

  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  return options;
}

function isWithinRoot(filePath, root) {
  return filePath === root || filePath.startsWith(`${root}${path.sep}`);
}

function resolveRequestPath(requestUrl, root = siteOutputRoot) {
  let decodedPath;
  try {
    const url = new URL(requestUrl, 'http://localhost');
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  const relativePath = decodedPath.replace(/^[/\\]+/, '');
  const resolvedPath = path.resolve(root, relativePath);
  return isWithinRoot(resolvedPath, root) ? resolvedPath : null;
}

function getStats(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function getRequestTarget(requestUrl, root = siteOutputRoot) {
  const sourcePath = resolveRequestPath(requestUrl, root);
  if (!sourcePath) return { status: 403 };

  const sourceStats = getStats(sourcePath);
  if (sourceStats?.isFile()) {
    return { filePath: sourcePath };
  }

  if (sourceStats?.isDirectory()) {
    const indexPath = path.join(sourcePath, 'index.html');
    if (getStats(indexPath)?.isFile()) {
      return { filePath: indexPath };
    }
  }

  return { status: 404 };
}

function createDevCacheToken(filePath) {
  try {
    return String(Math.trunc(fs.statSync(filePath).mtimeMs));
  } catch {
    return String(Date.now());
  }
}

function getAssetPath(pathname) {
  const relativePath = pathname.replace(/^[/\\]+/, '');
  const sourcePath = path.resolve(repoRoot, relativePath);
  if (isWithinRoot(sourcePath, repoRoot) && getStats(sourcePath)?.isFile()) {
    return sourcePath;
  }

  const builtPath = path.resolve(siteOutputRoot, relativePath);
  return isWithinRoot(builtPath, siteOutputRoot) ? builtPath : null;
}

function cacheBustLocalAsset(assetUrl) {
  if (
    !assetUrl ||
    assetUrl.startsWith('#') ||
    assetUrl.startsWith('data:') ||
    assetUrl.startsWith('javascript:') ||
    assetUrl.startsWith('vbscript:') ||
    /^[a-z][a-z0-9+.-]*:/i.test(assetUrl)
  ) {
    return assetUrl;
  }

  const [withoutHash, hash = ''] = assetUrl.split('#');
  const [pathname, query = ''] = withoutHash.split('?');
  if (!mimeTypes.has(path.extname(pathname).toLowerCase())) {
    return assetUrl;
  }

  const assetPath = getAssetPath(pathname);
  if (!assetPath) {
    return assetUrl;
  }

  const separator = query ? '&' : '?';
  const hashPart = hash ? `#${hash}` : '';
  return `${pathname}${query ? `?${query}` : ''}${separator}dev=${createDevCacheToken(assetPath)}${hashPart}`;
}

function cacheBustModuleSpecifier(specifier, importerPath) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return specifier;
  }

  const [withoutHash, hash = ''] = specifier.split('#');
  const [pathname, query = ''] = withoutHash.split('?');
  const assetPath = path.resolve(path.dirname(importerPath), pathname);
  if (!isWithinRoot(assetPath, siteOutputRoot)) {
    return specifier;
  }

  const separator = query ? '&' : '?';
  const hashPart = hash ? `#${hash}` : '';
  return `${pathname}${query ? `?${query}` : ''}${separator}dev=${createDevCacheToken(assetPath)}${hashPart}`;
}

function injectDevelopmentMode(html) {
  const withAssetCacheBusters = html.replace(
    /\b(src|href)="([^"]+)"/g,
    (match, attribute, assetUrl) => `${attribute}="${cacheBustLocalAsset(assetUrl)}"`
  );
  const marker = 'window.EFFECTUNE_DEV_SERVER = true;';
  if (withAssetCacheBusters.includes(marker)) {
    return withAssetCacheBusters;
  }
  return withAssetCacheBusters.replace(
    '</head>',
    `    <script>${marker}</script>\n</head>`
  );
}

function injectJavaScriptCacheBusters(source, filePath) {
  return source
    .replace(
      /\b((?:import|export)\s+(?:[^'"]*?\s+from\s*)?)(['"])(\.{1,2}\/[^'"]+)\2/g,
      (match, prefix, quote, specifier) => `${prefix}${quote}${cacheBustModuleSpecifier(specifier, filePath)}${quote}`
    )
    .replace(
      /\b(import\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2(\s*\))/g,
      (match, prefix, quote, specifier, suffix) => `${prefix}${quote}${cacheBustModuleSpecifier(specifier, filePath)}${quote}${suffix}`
    );
}

function setNoCacheHeaders(response, contentType) {
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Expires', '0');
  response.setHeader('X-EffeTune-Dev-Server', '1');
  if (contentType) {
    response.setHeader('Content-Type', contentType);
  }
}

function getMimeType(filePath) {
  return mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

function sendFile(response, request, filePath, status = 200) {
  const extension = path.extname(filePath).toLowerCase();
  setNoCacheHeaders(response, getMimeType(filePath));

  if (request.method === 'HEAD') {
    response.writeHead(status);
    response.end();
    return;
  }

  if (extension === '.html') {
    const html = fs.readFileSync(filePath, 'utf8');
    response.writeHead(status);
    response.end(injectDevelopmentMode(html));
    return;
  }

  if (extension === '.js' || extension === '.mjs') {
    const source = fs.readFileSync(filePath, 'utf8');
    response.writeHead(status);
    response.end(injectJavaScriptCacheBusters(source, filePath));
    return;
  }

  response.writeHead(status);
  fs.createReadStream(filePath).pipe(response);
}

function sendError(response, request, status, message, root) {
  const errorPage = status === 404 ? path.join(root, '404.html') : null;
  if (errorPage && getStats(errorPage)?.isFile()) {
    sendFile(response, request, errorPage, status);
    return;
  }

  setNoCacheHeaders(response, 'text/plain; charset=utf-8');
  response.writeHead(status);
  response.end(request.method === 'HEAD' ? undefined : message);
}

function createRequestHandler(root = siteOutputRoot) {
  return function handleRequest(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendError(response, request, 405, 'Method Not Allowed', root);
      return;
    }

    const target = getRequestTarget(request.url || '/', root);
    if (target.status === 403) {
      sendError(response, request, 403, 'Forbidden', root);
      return;
    }

    if (target.status === 404) {
      sendError(response, request, 404, 'Not Found', root);
      return;
    }

    sendFile(response, request, target.filePath);
  };
}

function parseGitHubPagesVersion(output) {
  return output.match(/\bgithub-pages\s+([0-9.]+)\b/i)?.[1] || null;
}

function createGitHubPagesVersionSpec() {
  return {
    command: 'ruby',
    args: ['-S', 'github-pages', '--version'],
    options: {
      cwd: repoRoot,
      windowsHide: true
    }
  };
}

function createDspLibraryBuildSpec(environment = process.env) {
  const npmArgs = [
    '--prefix',
    path.join(repoRoot, 'dsp', 'bindings', 'js'),
    'run',
    'build'
  ];
  const isWindows = process.platform === 'win32';
  return {
    command: isWindows ? environment.ComSpec || process.env.ComSpec || 'cmd.exe' : 'npm',
    args: isWindows ? ['/d', '/s', '/c', 'npm.cmd', ...npmArgs] : npmArgs,
    options: {
      cwd: repoRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
  };
}

function createJekyllBuildSpec(environment = process.env) {
  return {
    command: 'ruby',
    args: [
      '-rgithub-pages',
      '-S',
      'jekyll',
      'build',
      '--watch',
      '--incremental',
      '--source',
      repoRoot,
      '--destination',
      siteOutputRoot
    ],
    options: {
      cwd: repoRoot,
      env: {
        ...environment,
        JEKYLL_ENV: 'production'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
  };
}

function resetJekyllBuildState() {
  fs.rmSync(siteOutputRoot, { force: true, recursive: true });
  fs.rmSync(path.join(repoRoot, '.jekyll-metadata'), { force: true });
}

function collectProcessOutput(spec, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(spec.command, spec.args, spec.options);
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error((stderr || stdout || `Process exited with code ${code}`).trim()));
    });
  });
}

async function verifyGitHubPagesVersion(spawnProcess = spawn) {
  let result;
  try {
    result = await collectProcessOutput(createGitHubPagesVersionSpec(), spawnProcess);
  } catch {
    throw new Error(
      `GitHub Pages ${expectedGitHubPagesVersion} is required. Install Ruby, then run "gem install github-pages -v ${expectedGitHubPagesVersion}".`
    );
  }

  const installedVersion = parseGitHubPagesVersion(`${result.stdout}\n${result.stderr}`);
  if (installedVersion !== expectedGitHubPagesVersion) {
    throw new Error(
      `GitHub Pages ${expectedGitHubPagesVersion} is required, but ${installedVersion || 'no compatible version'} was found. Run "gem install github-pages -v ${expectedGitHubPagesVersion}".`
    );
  }
}

async function buildDspLibraryPackage(spawnProcess = spawn) {
  await collectProcessOutput(createDspLibraryBuildSpec(), spawnProcess);
}

function startJekyllWatcher({
  spawnProcess = spawn,
  onBuildComplete = () => {}
} = {}) {
  const spec = createJekyllBuildSpec();
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(spec.command, spec.args, spec.options);
    } catch (error) {
      reject(error);
      return;
    }

    let ready = false;
    let recentOutput = '';
    const completeBuild = () => {
      try {
        onBuildComplete();
      } catch (error) {
        child.kill();
        if (!ready) {
          reject(error);
        } else {
          console.error(`Unable to refresh the staged DSP preview: ${error.message}`);
        }
        return;
      }

      if (!ready) {
        ready = true;
        resolve(child);
      }
    };
    const handleOutput = (target, chunk) => {
      target.write(chunk);
      recentOutput += chunk;
      let completion = /\bdone in [\d.]+ seconds?\./i.exec(recentOutput);
      while (completion) {
        recentOutput = recentOutput.slice(completion.index + completion[0].length);
        completeBuild();
        completion = /\bdone in [\d.]+ seconds?\./i.exec(recentOutput);
      }
      recentOutput = recentOutput.slice(-8192);
    };

    child.stdout?.on('data', chunk => handleOutput(process.stdout, chunk));
    child.stderr?.on('data', chunk => handleOutput(process.stderr, chunk));
    child.once('error', error => {
      if (!ready) reject(error);
    });
    child.once('close', code => {
      if (!ready) {
        reject(new Error(`Jekyll exited before the initial build completed (code ${code}).`));
      }
    });
  });
}

async function assembleInitialSite({
  siteRoot = siteOutputRoot,
  buildPackage = buildDspLibraryPackage,
  startJekyll = startJekyllWatcher,
  stageSite = buildSite
} = {}) {
  await buildPackage();
  return startJekyll({
    onBuildComplete: () => {
      const dspRoot = path.join(siteRoot, 'dsp');
      stageSite(path.join(dspRoot, 'index.html'), dspRoot);
    }
  });
}

async function listen(server, port, host) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function startDevServer(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  await verifyGitHubPagesVersion();
  resetJekyllBuildState();

  console.log(
    `Building the DSP library and site with GitHub Pages ${expectedGitHubPagesVersion}. The initial build can take a few minutes...`
  );
  const jekyllProcess = await assembleInitialSite();
  const server = http.createServer(createRequestHandler());

  try {
    await listen(server, options.port, options.host);
  } catch (error) {
    jekyllProcess.kill();
    throw error;
  }

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    jekyllProcess.kill();
    server.close();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  jekyllProcess.once('close', code => {
    if (!shuttingDown) {
      console.error(`Jekyll stopped unexpectedly (code ${code}).`);
      process.exitCode = 1;
      server.close();
    }
  });

  console.log(`EffeTune dev server running at http://${options.host}:${options.port}/`);
  console.log(`Web app: http://${options.host}:${options.port}/effetune.html`);
  console.log(`Site home: http://${options.host}:${options.port}/`);
  console.log(`DSP library: http://${options.host}:${options.port}/dsp/`);
  console.log(`Japanese docs: http://${options.host}:${options.port}/docs/i18n/ja/`);
  console.log('Press Ctrl+C to stop.');

  return { jekyllProcess, server };
}

const handleRequest = createRequestHandler();

export {
  assembleInitialSite,
  createDspLibraryBuildSpec,
  createJekyllBuildSpec,
  createRequestHandler,
  getMimeType,
  getRequestTarget,
  handleRequest,
  parseGitHubPagesVersion,
  startJekyllWatcher,
  startDevServer
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startDevServer().catch(error => {
    console.error(`Unable to start the development server: ${error.message}`);
    process.exitCode = 1;
  });
}
