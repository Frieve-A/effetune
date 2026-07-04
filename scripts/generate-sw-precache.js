const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));
const includeRoots = ['js', 'plugins', 'images'];
const explicit = [
  'effetune.html',
  'effetune.css',
  'effetune-mobile.css',
  'manifest.json',
  'package.json',
  'sw.js',
  'plugins/plugins.txt'
];
const allowedExtensions = new Set(['.js', '.css', '.json', '.json5', '.png', '.ico', '.jpg', '.jpeg', '.svg', '.txt']);
const excludedPathPatterns = [
  /^images\/screenshot(?:-[^/]+)?\.png$/,
  /^images\/ogp\.jpg$/,
  /^images\/video_thumbnail\.jpg$/
];

function shouldPrecache(relativePath) {
  return !excludedPathPatterns.some(pattern => pattern.test(relativePath));
}

function walk(dir, output) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, output);
    } else if (allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
      const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
      if (shouldPrecache(relativePath)) {
        output.add(relativePath);
      }
    }
  }
}

const urls = new Set(explicit);
for (const dir of includeRoots) {
  walk(path.join(root, dir), urls);
}

const body = [
  `self.EFFECTUNE_CACHE_VERSION = ${JSON.stringify(`effetune-v${packageJson.version}`)};`,
  `self.EFFECTUNE_PRECACHE_URLS = ${JSON.stringify([...urls].sort().map(url => `./${url}`), null, 2)};`,
  ''
].join('\n');
fs.writeFileSync(path.join(root, 'sw-precache.js'), body);
