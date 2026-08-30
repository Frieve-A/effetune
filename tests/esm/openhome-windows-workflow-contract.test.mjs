import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  EXECUTABLE_MAGIC,
  TRACKED_LIBNL_LICENSE_PATH,
  TRACKED_NOTICE_PATH,
  verifyPackagedOpenHome,
} from '../../tools/verify-openhome-package.mjs';
import {
  parseDpkgRecord,
  parseDpkgSearch,
  parseDscChecksums,
} from '../../tools/openhome-linux-provenance.mjs';
import {
  parseBuildOptions,
  parseLinuxLibnlDependencies,
  posixOhNetMakeArgs,
} from '../../scripts/build-openhome-sidecar.mjs';

const workflows = {
  build: readFileSync(new URL('../../.github/workflows/build.yml', import.meta.url), 'utf8'),
  ci: readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  desktopRelease: readFileSync(
    new URL('../../.github/workflows/desktop-release.yml', import.meta.url),
    'utf8'
  ),
  dsp: readFileSync(new URL('../../.github/workflows/dsp.yml', import.meta.url), 'utf8'),
  release: readFileSync(new URL('../../.github/workflows/dsp-library-release.yml', import.meta.url), 'utf8'),
};
const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const sidecarBuildScript = readFileSync(
  new URL('../../scripts/build-openhome-sidecar.mjs', import.meta.url),
  'utf8'
);
const sidecarCmake = readFileSync(
  new URL('../../native/openhome-sidecar/CMakeLists.txt', import.meta.url),
  'utf8'
);
const sidecarNotice = readFileSync(TRACKED_NOTICE_PATH, 'utf8');

function jobBlock(workflow, jobName) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex(line => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `missing ${jobName} job`);
  const nextJob = lines.findIndex((line, index) => index > start && /^  [a-zA-Z0-9_-]+:$/.test(line));
  return lines.slice(start, nextJob < 0 ? lines.length : nextJob).join('\n');
}

test('Windows desktop packaging is owned by the reusable Electron build', () => {
  const dspWindows = jobBlock(workflows.dsp, 'windows');
  const releaseWindows = jobBlock(workflows.release, 'windows');
  const desktopWindows = jobBlock(workflows.desktopRelease, 'windows');
  const buildWindows = jobBlock(workflows.build, 'build-windows');
  assert.doesNotMatch(dspWindows, /pack:win|smoke:dsp-package|electron-builder/);
  assert.doesNotMatch(releaseWindows, /pack:win|smoke:dsp-package|electron-builder/);
  assert.match(desktopWindows, /uses: \.\/\.github\/workflows\/build\.yml/);
  assert.match(desktopWindows, /^\s+stage: windows$/m);
  assert.match(desktopWindows, /^\s+source_verified: true$/m);
  assert.match(buildWindows, /npx electron-builder --publish never/);
  assert.match(buildWindows, /npm run smoke:dsp-package/);
  assert.match(buildWindows, /npm run smoke:openhome-package/);

  const openHomeNative = jobBlock(workflows.ci, 'openhome-native');
  const install = openHomeNative.indexOf('run: npm ci --ignore-scripts');
  const execute = openHomeNative.indexOf('run: ${{ matrix.command }}');
  assert.match(openHomeNative, /runner: windows-latest\s+command: npm run build:openhome-sidecar -- --no-publish-development/);
  assert.doesNotMatch(openHomeNative, /pack:win|electron-builder/);
  assert.ok(install >= 0 && execute > install, 'OpenHome CI must install before building and verification');
});

test('OpenHome native CI builds Windows x64, Linux x64, and both macOS architectures', () => {
  const openHomeNative = jobBlock(workflows.ci, 'openhome-native');
  for (const expected of [
    'runner: windows-latest',
    'runner: ubuntu-latest',
    'runner: macos-15-intel',
    'runner: macos-15',
    'npm run build:openhome-sidecar -- --arch x64 --no-publish-development',
    'npm run build:openhome-sidecar -- --arch arm64 --no-publish-development',
  ]) {
    assert.match(openHomeNative, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('all desktop packages include the native sidecar and its tracked notices', () => {
  for (const platform of ['win', 'mac', 'linux']) {
    const resources = packageJson.build[platform].extraResources;
    assert.ok(Array.isArray(resources), `${platform} package must define extraResources`);
    const destinations = resources.map(resource => resource.to).sort();
    const expectedDestinations = [
      'openhome/THIRD_PARTY_NOTICES.txt',
      `openhome/effetune-openhome-sidecar${platform === 'win' ? '.exe' : ''}`,
    ];
    if (platform === 'linux') {
      expectedDestinations.push(
        'openhome',
        'openhome/libnl-LGPL-2.1.txt',
        'openhome/libnl-runtime-manifest.json'
      );
      const runtimeResource = resources.find(resource => resource.to === 'openhome');
      assert.deepEqual(runtimeResource.filter, ['libnl*-3.so*']);
    }
    assert.deepEqual(destinations, expectedDestinations.sort());
  }
});

function addUnpackedPackage(root, platform, directory = `${platform}-unpacked`) {
  const resourcesPath = platform === 'mac'
    ? path.join(root, directory, 'EffeTune.app', 'Contents', 'Resources')
    : path.join(root, directory, 'resources');
  const openHomePath = path.join(resourcesPath, 'openhome');
  mkdirSync(openHomePath, { recursive: true });
  const executableName = platform === 'win'
    ? 'effetune-openhome-sidecar.exe'
    : 'effetune-openhome-sidecar';
  writeFileSync(
    path.join(openHomePath, executableName),
    Buffer.concat([EXECUTABLE_MAGIC[platform][0], Buffer.from('fixture')])
  );
  writeFileSync(
    path.join(openHomePath, 'THIRD_PARTY_NOTICES.txt'),
    readFileSync(TRACKED_NOTICE_PATH)
  );
  if (platform === 'linux') {
    writeFileSync(
      path.join(openHomePath, 'libnl-LGPL-2.1.txt'),
      readFileSync(TRACKED_LIBNL_LICENSE_PATH)
    );
    const core = Buffer.from('libnl fixture');
    const genl = Buffer.from('libnl-genl fixture');
    writeFileSync(path.join(openHomePath, 'libnl-3.so.200'), core);
    writeFileSync(
      path.join(openHomePath, 'libnl-genl-3.so.200'),
      genl
    );
    const packageFields = {
      version: '3.7.0-0.2build1',
      architecture: 'amd64',
      sourcePackage: 'libnl3',
      sourceVersion: '3.7.0-0.2build1',
    };
    writeFileSync(path.join(openHomePath, 'libnl-runtime-manifest.json'), JSON.stringify({
      schemaVersion: 1,
      platform: 'linux',
      architecture: 'x64',
      sourceComplete: false,
      runtimeLibraries: [
        {
          fileName: 'libnl-3.so.200',
          soname: 'libnl-3.so.200',
          sha256: createHash('sha256').update(core).digest('hex'),
          binaryPackage: 'libnl-3-200:amd64',
          ...packageFields,
        },
        {
          fileName: 'libnl-genl-3.so.200',
          soname: 'libnl-genl-3.so.200',
          sha256: createHash('sha256').update(genl).digest('hex'),
          binaryPackage: 'libnl-genl-3-200:amd64',
          ...packageFields,
        },
      ],
      sourceArtifacts: [],
    }));
  }
}

test('OpenHome package verification accepts Windows, Linux, and macOS layouts', t => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'effetune-openhome-package-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  addUnpackedPackage(root, 'win');
  addUnpackedPackage(root, 'linux');
  for (const directory of ['mac', 'mac-x64', 'mac-arm64']) {
    addUnpackedPackage(root, 'mac', directory);
  }

  assert.equal(verifyPackagedOpenHome(root).length, 5);
});

test('packaging builds can preserve a verified architecture artifact without publishing the development sidecar', () => {
  assert.deepEqual(parseBuildOptions(['--arch', 'arm64', '--no-publish-development']), {
    architecture: 'arm64',
    publishDevelopment: false,
  });
  assert.equal(parseBuildOptions([]).publishDevelopment, true);
});

test('OpenHome dependency builds use portable copy arguments on macOS', () => {
  assert.deepEqual(posixOhNetMakeArgs('darwin', 'arm64'), [
    'ohNetCore',
    'rsync=no',
    'cp=cp',
  ]);
  assert.deepEqual(posixOhNetMakeArgs('darwin', 'x64'), [
    'ohNetCore',
    'rsync=no',
    'cp=cp',
    'Mac-x64=1',
  ]);
  assert.deepEqual(posixOhNetMakeArgs('linux', 'x64'), ['ohNetCore', 'rsync=no']);
});

test('desktop tag jobs build every platform package after exact-version preflight', () => {
  const desktopPackageContract = [
    workflows.build,
    workflows.ci,
    workflows.desktopRelease,
    JSON.stringify(packageJson.build),
  ].join('\n');
  assert.doesNotMatch(
    desktopPackageContract,
    /environment:\s*release|CSC_|APPLE_(?:ID|TEAM|APP)|codesign|notari[sz]|stapler|Authenticode|forceCodeSigning|"entitlements(?:Inherit)?"/i
  );
  assert.match(workflows.desktopRelease, /^\s+tags:\s*$/m);
  assert.match(workflows.desktopRelease, /^\s+- 'v\*'$/m);
  assert.doesNotMatch(workflows.desktopRelease, /pull_request:|workflow_dispatch:/);

  const preflight = jobBlock(workflows.desktopRelease, 'preflight');
  assert.match(preflight, /github\.repository == 'Frieve-A\/effetune'/);
  assert.match(preflight, /expected="v\$\(node -p "require\('\.\/package\.json'\)\.version"\)"/);
  assert.match(preflight, /test "\$GITHUB_REF_NAME" = "\$expected"/);
  assert.match(preflight, /dsp-v\*/);
  assert.match(preflight, /npm audit signatures/);
  assert.equal(preflight.match(/npm run verify/g)?.length, 1);

  const windows = jobBlock(workflows.desktopRelease, 'windows');
  assert.match(windows, /^\s+needs: preflight$/m);
  assert.match(windows, /uses: \.\/\.github\/workflows\/build\.yml/);
  assert.match(windows, /^\s+stage: windows$/m);
  assert.match(windows, /^\s+source_verified: true$/m);
  assert.match(windows, /^\s+release_artifacts: true$/m);

  const macos = jobBlock(workflows.desktopRelease, 'macos');
  assert.match(macos, /^\s+needs: preflight$/m);
  assert.match(macos, /uses: \.\/\.github\/workflows\/build\.yml/);
  assert.match(macos, /^\s+stage: macos$/m);
  assert.match(macos, /^\s+source_verified: true$/m);
  assert.match(macos, /^\s+release_artifacts: true$/m);

  const linux = jobBlock(workflows.desktopRelease, 'linux');
  assert.match(linux, /^\s+needs: preflight$/m);
  assert.match(linux, /^\s+openhome_source_bundle: true$/m);
  assert.match(linux, /^\s+source_verified: true$/m);
  assert.match(linux, /^\s+release_artifacts: true$/m);

  const buildWindows = jobBlock(workflows.build, 'build-windows');
  const buildMacos = jobBlock(workflows.build, 'build-macos');
  assert.match(buildWindows, /npx electron-builder --publish never/);
  assert.match(buildMacos, /npx electron-builder --mac --\$\{\{ matrix\.arch \}\} --publish never/);
  for (const build of [buildWindows, buildMacos]) {
    assert.match(build, /^\s+if: inputs\.source_verified$/m);
    for (const hostTest of [
      'tests/cjs/electron-ipc-handlers-mini-player.test.cjs',
      'tests/cjs/electron-ipc-handlers.test.cjs',
      'tests/cjs/electron-ir-library-ipc.test.cjs',
      'tests/cjs/electron-library-catalog-scan-runtime.test.cjs',
      'tests/cjs/electron-preload-clipboard.test.cjs',
      'tests/esm/dev-server.test.mjs',
    ]) {
      assert.match(build, new RegExp(hostTest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
});

test('desktop package entrypoints clean before invoking the canonical OpenHome producer', () => {
  const producer = 'npm run build:openhome-sidecar -- --no-publish-development';
  for (const script of ['build', 'build:portable', 'build:installer', 'build:linux', 'pack', 'pack:win', 'dist']) {
    const command = packageJson.scripts[script];
    assert.ok(command.indexOf('npm run clean') < command.indexOf(producer), `${script} must clean before producing`);
  }
  for (const script of ['build:mac:x64', 'build:mac:arm64']) {
    const command = packageJson.scripts[script];
    assert.equal(command.match(/npm run clean/g)?.length, 1, `${script} must clean exactly once`);
    assert.ok(command.indexOf('npm run clean') < command.indexOf('npm run build:openhome-sidecar'));
    const architecture = script.endsWith('x64') ? 'x64' : 'arm64';
    assert.match(command, new RegExp(`--arch ${architecture} --no-publish-development`));
    assert.match(command, new RegExp(`electron-builder --mac --${architecture}`));
  }
  assert.equal(packageJson.scripts['build:mac'], undefined);
  assert.equal(packageJson.build.mac.target, 'dmg');
  assert.doesNotMatch(workflows.build, /node scripts\/build-openhome-sidecar\.mjs/);
  assert.doesNotMatch(workflows.ci, /node scripts\/build-openhome-sidecar\.mjs/);
  assert.doesNotMatch(workflows.desktopRelease, /node scripts\/build-openhome-sidecar\.mjs/);
});

test('Linux sidecars package loader-resolved libnl beside an $ORIGIN-linked executable', () => {
  assert.match(sidecarBuildScript, /makeArgs\.push\('requirelibnl='\)/);
  assert.match(sidecarBuildScript, /pkg-config[\s\S]*libnl-3\.0[\s\S]*libnl-genl-3\.0/);
  assert.match(sidecarCmake, /pkg_check_modules\(LIBNL REQUIRED IMPORTED_TARGET libnl-3\.0 libnl-genl-3\.0\)/);
  assert.match(sidecarCmake, /PkgConfig::LIBNL/);
  assert.match(sidecarCmake, /BUILD_RPATH "\$ORIGIN"/);
  assert.match(sidecarNotice, /dynamically\s+links[\s\S]*libnl-3[\s\S]*libnl-genl-3/);
  assert.match(sidecarBuildScript, /collectLinuxLibnlRuntime\(executable, targetOutputRoot\)/);
  assert.deepEqual(
    [...parseLinuxLibnlDependencies(`
      libnl-3.so.200 => /usr/lib/x86_64-linux-gnu/libnl-3.so.200 (0x1)
      libnl-genl-3.so.200 => /usr/lib/x86_64-linux-gnu/libnl-genl-3.so.200 (0x2)
    `)],
    [
      ['libnl-3.so.200', '/usr/lib/x86_64-linux-gnu/libnl-3.so.200'],
      ['libnl-genl-3.so.200', '/usr/lib/x86_64-linux-gnu/libnl-genl-3.so.200'],
    ]
  );
});

test('Linux provenance resolves package path aliases without accepting unrelated or ambiguous owners', t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'effetune-libnl-owner-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const libraryDirectory = path.join(root, 'usr', 'lib');
  const aliasDirectory = path.join(root, 'lib');
  mkdirSync(libraryDirectory, { recursive: true });
  symlinkSync(libraryDirectory, aliasDirectory, 'junction');
  const library = path.join(libraryDirectory, 'libnl-3.so.200');
  const alias = path.join(aliasDirectory, 'libnl-3.so.200');
  const unrelated = path.join(root, 'libnl-3.so.200');
  writeFileSync(library, 'library');
  writeFileSync(unrelated, 'different library');
  const owner = 'libnl-3-200:amd64';
  assert.equal(parseDpkgSearch(`${owner}: ${library}`, library), owner);
  assert.equal(parseDpkgSearch([
    `${owner}: ${alias}`,
    `${owner}: ${library}`,
    `unrelated: ${unrelated}`,
    `absent: ${path.join(root, 'missing')}`,
  ].join('\n'), library), owner);
  assert.throws(() => parseDpkgSearch(`unrelated: ${unrelated}`, library), /exactly one dpkg owner/);
  assert.throws(() => parseDpkgSearch(
    `${owner}: ${alias}\nother-package: ${library}`, library
  ), /exactly one dpkg owner/);
  assert.throws(() => parseDpkgSearch(
    `${owner}, other-package: ${library}`, library
  ), /exactly one dpkg owner/);
});

test('Linux release provenance binds packaged binaries to complete exact Debian source artifacts', () => {
  assert.deepEqual(
    parseDpkgRecord('libnl-3-200:amd64\t3.7.0-0.2build1\tamd64\tlibnl3\t3.7.0-0.2build1'),
    {
      binaryPackage: 'libnl-3-200:amd64',
      version: '3.7.0-0.2build1',
      architecture: 'amd64',
      sourcePackage: 'libnl3',
      sourceVersion: '3.7.0-0.2build1',
    }
  );
  assert.deepEqual(parseDscChecksums(`Format: 3.0 (quilt)
Checksums-Sha256:
 ${'a'.repeat(64)} 123 libnl3_3.7.0.orig.tar.gz
 ${'b'.repeat(64)} 456 libnl3_3.7.0-0.2build1.debian.tar.xz
`), [
    { sha256: 'a'.repeat(64), size: 123, fileName: 'libnl3_3.7.0.orig.tar.gz' },
    { sha256: 'b'.repeat(64), size: 456, fileName: 'libnl3_3.7.0-0.2build1.debian.tar.xz' },
  ]);
  assert.match(workflows.build, /Types: deb deb-src/);
  for (const prerequisite of ['apt-get', 'dpkg-dev', 'libnl-3-dev', 'libnl-genl-3-dev']) {
    assert.match(workflows.build, new RegExp(prerequisite));
  }
  assert.match(workflows.build, /collect:openhome-linux-provenance -- --with-source/);
  assert.match(workflows.build, /verify:openhome-linux-provenance -- --require-source/);
  assert.match(workflows.build, /OpenHome-Linux-Source\.zip/);
  assert.match(sidecarBuildScript, /openhome-linux-provenance\.mjs/);
  assert.match(workflows.ci, /Verify Linux OpenHome provenance manifest[\s\S]*verify:openhome-linux-provenance/);
  assert.doesNotMatch(workflows.build, /tmp\/dev|tmp\\dev/);
  assert.doesNotMatch(workflows.desktopRelease, /tmp\/dev|tmp\\dev/);
});

test('edited workflows keep external actions pinned to commit SHAs', () => {
  for (const [name, workflow] of Object.entries(workflows)) {
    for (const line of workflow.split(/\r?\n/)) {
      const reference = line.match(/\buses:\s+(\S+)/)?.[1];
      if (!reference || reference.startsWith('./')) {
        continue;
      }
      assert.match(reference, /@[0-9a-f]{40}$/, `${name}: unpinned action ${reference}`);
    }
  }
});
