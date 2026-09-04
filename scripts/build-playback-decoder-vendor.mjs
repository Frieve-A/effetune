import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(repoRoot, 'node_modules', 'mediabunny', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const expectedVersion = '1.55.7';
if (packageJson.version !== expectedVersion) {
  throw new Error(`Expected mediabunny ${expectedVersion}, found ${packageJson.version}`);
}

const outputPath = path.join(repoRoot, 'js', 'vendor', 'rolling-pcm-decoder-worker.mjs');
const noticePath = path.join(repoRoot, 'js', 'vendor', 'rolling-pcm-decoder-worker.NOTICE.txt');
await esbuild.build({
  entryPoints: [path.join(repoRoot, 'js', 'ui', 'audio-player', 'rolling-pcm-worker-entry.js')],
  outfile: outputPath,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2021'],
  minify: true,
  legalComments: 'none',
  banner: { js: `/* EffeTune rolling PCM decoder; mediabunny ${expectedVersion} (MPL-2.0) */` }
});

const output = fs.readFileSync(outputPath);
const digest = crypto.createHash('sha256').update(output).digest('hex');
const licensePath = path.join(repoRoot, 'node_modules', 'mediabunny', 'LICENSE');
const license = fs.readFileSync(licensePath, 'utf8').replace(/\r\n?/g, '\n').trim();
const notice = [
  'EffeTune Rolling PCM Decoder Worker',
  '',
  `Generated from mediabunny ${expectedVersion}.`,
  'Source: https://github.com/Vanilagy/mediabunny',
  `Bundle SHA-256: ${digest}`,
  '',
  'mediabunny license:',
  '',
  license,
  ''
].join('\n');
fs.writeFileSync(noticePath, notice);

console.log(`Built ${path.relative(repoRoot, outputPath)} (${output.byteLength} bytes, sha256 ${digest}).`);
