import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  ['.md', 'text/markdown; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
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

function setNoCacheHeaders(response, contentType) {
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Expires', '0');
  response.setHeader('X-EffeTune-Dev-Server', '1');
  if (contentType) {
    response.setHeader('Content-Type', contentType);
  }
}

function resolveRequestPath(requestUrl) {
  let url;
  let decodedPath;
  try {
    url = new URL(requestUrl, 'http://localhost');
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const relativePath = decodedPath.replace(/^\/+/, '') || '.';
  const absolutePath = path.resolve(repoRoot, relativePath);

  if (absolutePath !== repoRoot && !absolutePath.startsWith(`${repoRoot}${path.sep}`)) {
    return null;
  }

  return absolutePath;
}

function createDevCacheToken(filePath) {
  try {
    return String(Math.trunc(fs.statSync(filePath).mtimeMs));
  } catch {
    return String(Date.now());
  }
}

function cacheBustLocalAsset(assetUrl) {
  if (
    !assetUrl ||
    assetUrl.startsWith('#') ||
    assetUrl.startsWith('data:') ||
    assetUrl.startsWith('javascript:') ||
    /^[a-z][a-z0-9+.-]*:/i.test(assetUrl)
  ) {
    return assetUrl;
  }

  const [withoutHash, hash = ''] = assetUrl.split('#');
  const [pathname, query = ''] = withoutHash.split('?');
  const extension = path.extname(pathname).toLowerCase();
  if (!mimeTypes.has(extension)) {
    return assetUrl;
  }

  const assetPath = path.resolve(repoRoot, pathname.replace(/^\/+/, ''));
  if (assetPath !== repoRoot && !assetPath.startsWith(`${repoRoot}${path.sep}`)) {
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
  if (assetPath !== repoRoot && !assetPath.startsWith(`${repoRoot}${path.sep}`)) {
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

function sendDirectoryListing(response, requestUrl, directoryPath) {
  const url = new URL(requestUrl, 'http://localhost');
  const rows = fs.readdirSync(directoryPath, { withFileTypes: true })
    .map(entry => {
      const suffix = entry.isDirectory() ? '/' : '';
      const href = path.posix.join(url.pathname, entry.name) + suffix;
      return `<li><a href="${href}">${entry.name}${suffix}</a></li>`;
    })
    .join('\n');
  const body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>EffeTune dev server</title></head>
<body>
<h1>EffeTune dev server</h1>
<ul>
${rows}
</ul>
</body>
</html>`;

  setNoCacheHeaders(response, 'text/html; charset=utf-8');
  response.writeHead(200);
  response.end(body);
}

function sendFile(response, request, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes.get(extension) || 'application/octet-stream';
  setNoCacheHeaders(response, contentType);

  if (request.method === 'HEAD') {
    response.writeHead(200);
    response.end();
    return;
  }

  if (path.basename(filePath) === 'effetune.html') {
    const html = fs.readFileSync(filePath, 'utf8');
    response.writeHead(200);
    response.end(injectDevelopmentMode(html));
    return;
  }

  if (extension === '.js' || extension === '.mjs') {
    const source = fs.readFileSync(filePath, 'utf8');
    response.writeHead(200);
    response.end(injectJavaScriptCacheBusters(source, filePath));
    return;
  }

  response.writeHead(200);
  fs.createReadStream(filePath).pipe(response);
}

function handleRequest(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    setNoCacheHeaders(response, 'text/plain; charset=utf-8');
    response.writeHead(405);
    response.end('Method Not Allowed');
    return;
  }

  const requestPath = resolveRequestPath(request.url || '/');
  if (!requestPath) {
    setNoCacheHeaders(response, 'text/plain; charset=utf-8');
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.stat(requestPath, (error, stats) => {
    if (error) {
      setNoCacheHeaders(response, 'text/plain; charset=utf-8');
      response.writeHead(404);
      response.end('Not Found');
      return;
    }

    if (stats.isDirectory()) {
      const indexPath = path.join(requestPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        sendFile(response, request, indexPath);
      } else {
        sendDirectoryListing(response, request.url || '/', requestPath);
      }
      return;
    }

    sendFile(response, request, requestPath);
  });
}

const { host, port } = parseArgs(process.argv.slice(2));
const server = http.createServer(handleRequest);

server.listen(port, host, () => {
  console.log(`EffeTune dev server running at http://${host}:${port}/`);
  console.log(`Web app: http://${host}:${port}/effetune.html`);
  console.log('Press Ctrl+C to stop.');
});
