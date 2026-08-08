import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli || path.basename(npmCli) !== 'npm-cli.js') {
  throw new Error('npm_execpath does not identify npm-cli.js.');
}
const temporaryRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'effetune-npm-install-')));
const installRoot = path.join(temporaryRoot, 'consumer');
const npmEnvironment = {
  ...process.env,
  npm_config_cache: path.join(temporaryRoot, 'cache'),
  npm_config_audit: 'false',
  npm_config_fund: 'false'
};

try {
  await mkdir(installRoot);
  await run(process.execPath, [
    npmCli,
    'pack',
    '--pack-destination',
    temporaryRoot
  ], {
    cwd: packageRoot,
    maxBuffer: 16 * 1024 * 1024,
    env: npmEnvironment
  });
  const tarballs = (await readdir(temporaryRoot)).filter(file => file.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error('npm pack did not create exactly one package archive.');
  const archive = path.join(temporaryRoot, tarballs[0]);
  await run(process.execPath, [
    npmCli,
    'install',
    '--ignore-scripts',
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
    '--prefix',
    installRoot,
    archive
  ], {
    cwd: installRoot,
    maxBuffer: 16 * 1024 * 1024,
    env: npmEnvironment
  });

  const smoke = [
    "import('@effetune/dsp').then(async m => {",
    "  if (m.EFFECT_TYPES.length !== 83) throw new Error('catalog mismatch');",
    "  if (m.EFFECT_CATALOG.channels.length !== 15) throw new Error('catalog channels missing');",
    "  for (const type of m.EFFECT_TYPES) {",
    "    const factoryName = `create${type}`;",
    "    if (typeof m[type] !== 'function') throw new Error(`missing class ${type}`);",
    "    if (typeof m[factoryName] !== 'function') throw new Error(`missing factory ${factoryName}`);",
    "  }",
    "  const eta1 = m.encodeEta1({channels: [Float32Array.of(1)], sampleRate: 48000, topology: 'mono'});",
    "  if (!(eta1 instanceof ArrayBuffer) || eta1.byteLength !== 36) throw new Error('ETA1 encoding failed');",
    "  const chain = await m.createChain({version: 1, chain: [{type: 'Compressor', parameters: {threshold: -18}}]}, {variant: 'baseline'});",
    "  const input = [new Float32Array(128).fill(1)];",
    "  const output = await chain.process(input, {sampleRate: 48000});",
    "  chain.close();",
    "  if (output.length !== 1 || output[0].length !== 128 || output[0][127] === 1) throw new Error('preset execution failed');",
    "  const generated = await import('@effetune/dsp');",
    "  new generated.Compressor({threshold: -12});",
    "  const catalog = await import('@effetune/dsp/catalog');",
    "  if (catalog.EFFECT_CATALOG.effects.length !== 83) throw new Error('catalog subpath failed');",
    "})"
  ].join('\n');
  await run(process.execPath, ['--input-type=module', '--eval', smoke], {
    cwd: installRoot,
    maxBuffer: 16 * 1024 * 1024
  });
  console.log('Temporary npm install, import, and baseline preset execution verified.');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
