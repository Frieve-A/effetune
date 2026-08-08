// Fails when the committed dependency tree grows a package whose install runs
// arbitrary code, or when the repository stops blocking those scripts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Packages that ship preinstall/install/postinstall scripts and are allowed to
// remain in the tree. Their scripts stay blocked; the reason records why the
// blocked script costs us nothing. Nothing here is rebuilt automatically.
const allowed = new Map([
  [
    'esbuild',
    'Bundles the browser metadata parser. Resolves its binary from the @esbuild/* platform package, so the postinstall copy step is redundant.'
  ],
  [
    'electron-winstaller',
    'Reached only through the Squirrel.Windows target of electron-builder, which this project never packages.'
  ],
  [
    'fsevents',
    'Optional macOS file-watching accelerator. Watchers fall back to polling when its native build is skipped.'
  ]
]);

const lockfile = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const npmrc = fs.readFileSync(path.join(root, '.npmrc'), 'utf8');

const failures = [];

if (!/^\s*ignore-scripts\s*=\s*true\s*$/m.test(npmrc)) {
  failures.push('.npmrc no longer sets ignore-scripts=true, so dependency install scripts would run.');
}

const found = new Set();
for (const [location, entry] of Object.entries(lockfile.packages ?? {})) {
  if (!entry.hasInstallScript) {
    continue;
  }
  const name = entry.name ?? location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
  found.add(name);
  if (!allowed.has(name)) {
    failures.push(
      `${location} runs an install script and is not on the allowlist. Review the package, then add it to scripts/check-install-scripts.mjs with the reason its script can stay blocked.`
    );
  }
}

for (const name of allowed.keys()) {
  if (!found.has(name)) {
    failures.push(`${name} is on the allowlist but no longer has an install script in package-lock.json. Drop the stale entry.`);
  }
}

if (failures.length > 0) {
  console.error('Install script check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Install scripts blocked; ${found.size} allowlisted packages carry one and none are executed.`);
