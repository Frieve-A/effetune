const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const defaultRoot = path.resolve(__dirname, '..');
const includeRoots = ['js', 'plugins', 'images', 'presets'];
const explicit = [
  'effetune.html',
  'effetune.css',
  'effetune-mobile.css',
  'effetune-library.css',
  'features/effetune-benchmark.js',
  'manifest.json',
  'package.json',
  'sw.js',
  'plugins/plugins.txt'
];
const allowedExtensions = new Set(['.js', '.mjs', '.css', '.json', '.json5', '.png', '.ico', '.jpg', '.jpeg', '.svg', '.txt', '.wasm', '.effetune_preset']);
const binaryExtensions = new Set(['.ico', '.jpeg', '.jpg', '.png', '.wasm']);
const excludedPathPatterns = [
  /^images\/screenshot(?:-[^/]+)?\.png$/,
  /^images\/ogp\.jpg$/,
  /^images\/video_thumbnail\.jpg$/,
  /^plugins\/dsp\/effetune-dsp\.debug\.wasm$/
];

function shouldPrecache(relativePath) {
  return !excludedPathPatterns.some(pattern => pattern.test(relativePath));
}

function walk(root, dir, output) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, fullPath, output);
    } else if (allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
      const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
      if (shouldPrecache(relativePath)) {
        output.add(relativePath);
      }
    }
  }
}

function collectPrecacheUrls(root = defaultRoot) {
  const urls = new Set(explicit);
  for (const dir of includeRoots) {
    walk(root, path.join(root, dir), urls);
  }
  return [...urls].sort();
}

function readPackageJson(root = defaultRoot) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

function createPrecacheDigest(root, urls) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of urls) {
    let contents = fs.readFileSync(path.join(root, relativePath));
    if (!binaryExtensions.has(path.extname(relativePath).toLowerCase())) {
      contents = Buffer.from(contents.toString('utf8').replace(/\r\n?/g, '\n'));
    }
    hash.update(`${relativePath.length}:${relativePath}\n`);
    hash.update(`${contents.length}:`);
    hash.update(contents);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function buildPrecacheSource({ root = defaultRoot, packageJson = readPackageJson(root) } = {}) {
  const urls = collectPrecacheUrls(root);
  const digest = createPrecacheDigest(root, urls);
  const cacheVersion = `effetune-v${packageJson.version}-${digest.slice(0, 16)}`;
  const body = [
    `self.EFFECTUNE_CACHE_VERSION = ${JSON.stringify(cacheVersion)};`,
    `self.EFFECTUNE_PRECACHE_URLS = ${JSON.stringify(urls.map(url => `./${url}`), null, 2)};`,
    ''
  ].join('\n');

  return {
    body,
    cacheVersion,
    digest,
    urls
  };
}

function generatePrecache({ root = defaultRoot, outputPath = path.join(root, 'sw-precache.js') } = {}) {
  const result = buildPrecacheSource({ root });
  fs.writeFileSync(outputPath, result.body);
  return result;
}

function checkPrecache({ root = defaultRoot, outputPath = path.join(root, 'sw-precache.js') } = {}) {
  const result = buildPrecacheSource({ root });
  const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
  if (actual !== result.body) {
    const relativePath = path.relative(root, outputPath).replace(/\\/g, '/');
    throw new Error(`${relativePath} is stale; run npm run assets:web`);
  }
  return result;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const unknown = args.filter(argument => argument !== '--check');
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(', ')}`);
    process.exitCode = 1;
  } else {
    try {
      if (args.includes('--check')) {
        checkPrecache();
      } else {
        generatePrecache();
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  buildPrecacheSource,
  checkPrecache,
  collectPrecacheUrls,
  createPrecacheDigest,
  generatePrecache
};
