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
  patchOhNetSizeFormats,
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
  assert.match(buildWindows, /node scripts\/pack-ecs\.mjs --output dist/);
  assert.match(buildWindows, /npm run smoke:dsp-package/);
  assert.match(buildWindows, /npm run smoke:openhome-package/);
  assert.match(buildWindows, /^\s+dist\/latest\.yml$/m);
  assert.match(buildWindows, /^\s+dist\/\*-Setup\.exe\.blockmap$/m);
  assert.deepEqual(packageJson.build.publish, {
    provider: 'github',
    owner: 'Frieve-A',
    repo: 'effetune',
  });

  const openHomeNative = jobBlock(workflows.ci, 'openhome-native');
  const install = openHomeNative.indexOf('run: npm ci --ignore-scripts');
  const execute = openHomeNative.indexOf('run: ${{ matrix.command }}');
  assert.match(openHomeNative, /runner: windows-latest\s+command: npm run build:openhome-sidecar -- --no-publish-development/);
  assert.doesNotMatch(openHomeNative, /pack:win|electron-builder/);
  assert.ok(install >= 0 && execute > install, 'OpenHome CI must install before building and verification');
});

test('every desktop release builds its matching AirPlay runtime before packaging and checks the packaged copy', () => {
  for (const [platform, architecture] of [['linux', 'x64'], ['windows', 'x64'], ['macos', '${{ matrix.arch }}']]) {
    const block = jobBlock(workflows.build, `build-${platform}`);
    const steps = block.split(/\n      - name: /).slice(1);
    const native = steps.find(step => step.includes(`npm run build:airplay-receiver -- --arch ${architecture}`));
    const firstPack = steps.findIndex(step => step.includes('node scripts/pack-ecs.mjs'));
    const smoke = steps.findIndex(step => step.includes('run: npm run smoke:airplay-package'));
    const upload = steps.findIndex(step => step.startsWith(`Upload ${platform === 'macos' ? 'macOS' : platform === 'windows' ? 'Windows' : 'Linux'} artifacts`));
    assert.ok(native, `${platform} must produce the resource slice packaged by electron-builder`);
    assert.ok(steps.indexOf(native) <= firstPack && firstPack < smoke && smoke < upload, platform);
    assert.doesNotMatch(native, /\n        if:|continue-on-error:/, `${platform} native build cannot depend on optional source verification`);
    assert.doesNotMatch(steps[smoke], /\n        if:|continue-on-error:/, `${platform} package checks cannot be skipped for release variants`);
  }
  const linux = jobBlock(workflows.build, 'build-linux');
  const setup = linux.split(/\n      - name: /).find(step => step.startsWith('Install Linux native build dependencies'));
  assert.doesNotMatch(setup, /inputs\.third_party_source_bundle|\n        if:/, 'AirPlay always collects corresponding runtime sources');
  for (const prerequisite of ['deb-src', 'meson', 'ninja-build', 'patchelf', 'flex', 'bison', 'm4', 'libavahi-compat-libdnssd-dev', 'libdbus-1-dev']) {
    assert.ok(setup.includes(prerequisite), `Linux AirPlay toolchain requires ${prerequisite}`);
  }
  assert.doesNotMatch(setup, /apt-get install[^\n]*\bmeson\b/, 'Ubuntu 24.04 Meson is older than the locked GLib and GStreamer minimum');
  assert.match(setup, /python3 -m venv "\$meson_env"/);
  assert.match(setup, /"\$meson_env\/bin\/python" -m pip install[^\n]*'meson>=1\.4\.0'/);
  assert.match(setup, /export PATH="\$meson_env\/bin:\$PATH"/);
  assert.match(setup, /echo "\$meson_env\/bin" >> "\$GITHUB_PATH"/);
  assert.match(setup, /test "\$\(command -v meson\)" = "\$meson_env\/bin\/meson"/);
  assert.match(setup, /dpkg --compare-versions "\$meson_version" ge 1\.4\.0/);
  const macos = jobBlock(workflows.build, 'build-macos');
  assert.match(macos, /brew install .*meson.*flex.*bison.*m4/);
  assert.match(macos, /brew --prefix "\$tool"\)\/bin" >> "\$GITHUB_PATH"/);
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

test('Windows release signing is mandatory before installers and artifact upload', () => {
  const windows = jobBlock(workflows.build, 'build-windows');
  const caller = jobBlock(workflows.desktopRelease, 'windows');
  for (const secret of ['EVS_ACCOUNT_NAME', 'EVS_PASSWD']) {
    assert.ok(caller.includes(`${secret}: \${{ secrets.${secret} }}`));
    assert.match(workflows.build, new RegExp(`      ${secret}:\\s+description: [^\\n]+\\s+required: false`));
    assert.doesNotMatch(jobBlock(workflows.desktopRelease, 'linux'), new RegExp(secret));
    assert.doesNotMatch(workflows.ci, new RegExp(secret));
  }
  const pack = windows.indexOf('name: Build ECS application');
  const signing = windows.indexOf('name: Sign and verify Windows VMP');
  const installers = windows.indexOf('name: Package signed Windows installers');
  const upload = windows.indexOf('name: Upload Windows artifacts');
  assert.ok(pack < signing && signing < installers && installers < upload);
  const signStep = windows.slice(signing, installers);
  assert.doesNotMatch(signStep, /\n\s+if:|continue-on-error:/);
  assert.match(signStep, /GITHUB_REPOSITORY -ne 'Frieve-A\/effetune'/);
  assert.match(signStep, /GITHUB_REF_TYPE -ne 'tag'.*GITHUB_REF_NAME -ne "v\$version"/);
  assert.match(signStep, /-not \$env:EVS_ACCOUNT_NAME -or -not \$env:EVS_PASSWD/);
  assert.match(signStep, /castlabs_evs\.account --no-ask reauth/);
  assert.match(signStep, /castlabs_evs\.vmp --no-ask sign-pkg --streaming dist\/win-unpacked/);
  assert.match(signStep, /castlabs_evs\.vmp --no-ask verify-pkg --streaming dist\/win-unpacked/);
  assert.equal(signStep.match(/if \(\$LASTEXITCODE -ne 0\)/g)?.length, 4);
  assert.match(signStep, /finally[\s\S]*Remove-Item -LiteralPath \$env:EVS_CONFIG_FILE -Force/);
  assert.match(signStep, /EVS_CONFIG_FILE: \$\{\{ runner\.temp \}\}\/effetune-evs\.json/);
  const packaging = windows.slice(installers, upload);
  assert.doesNotMatch(packaging, /EVS_ACCOUNT_NAME|EVS_PASSWD/);
  assert.match(packaging, /if \(\$before -ne \$after\)/);
  assert.match(packaging, /verify-pkg --streaming dist\/win-unpacked/);
  assert.match(windows, /dist\/win-unpacked\/\*\.sig/);
  assert.doesNotMatch(windows, /continue-on-error:|if: always\(\)/);
});

test('macOS ECS release signs VMP before ad-hoc signing and preserves it through DMG packaging', () => {
  const macos = jobBlock(workflows.build, 'build-macos');
  const caller = jobBlock(workflows.desktopRelease, 'macos');
  for (const secret of ['EVS_ACCOUNT_NAME', 'EVS_PASSWD']) {
    assert.ok(caller.includes(`${secret}: \${{ secrets.${secret} }}`));
  }
  assert.match(macos, /runner: macos-15-intel\s+arch: x64/);
  assert.match(macos, /runner: macos-15\s+arch: arm64/);
  assert.match(macos, /node scripts\/prepare-ecs\.mjs/);
  assert.match(macos, /castlabs-evs==1\.3\.2/);
  const signing = macos.indexOf('name: Build and verify macOS VMP application');
  const packaging = macos.indexOf('name: Package verified macOS DMG');
  const upload = macos.indexOf('name: Upload macOS artifacts');
  assert.ok(signing >= 0 && signing < packaging && packaging < upload);
  const signStep = macos.slice(signing, packaging);
  assert.doesNotMatch(signStep, /\n\s+if:|continue-on-error:/);
  assert.match(signStep, /GITHUB_REPOSITORY" != 'Frieve-A\/effetune'/);
  assert.match(signStep, /GITHUB_REF_TYPE" != 'tag'.*GITHUB_REF_NAME" != "v\$\{version\}"/);
  assert.match(signStep, /EVS_ACCOUNT_NAME:\?Configure/);
  assert.match(signStep, /EVS_PASSWD:\?Configure/);
  assert.match(signStep, /EVS_CONFIG_FILE: \$\{\{ runner\.temp \}\}\/effetune-evs\.json/);
  assert.match(signStep, /trap 'rm -f -- "\$EVS_CONFIG_FILE"' EXIT/);
  assert.match(signStep, /set -euo pipefail/);
  assert.ok(signStep.indexOf('castlabs_evs.account --no-ask reauth') < signStep.indexOf('pack-ecs.mjs --sign-vmp --output dist'));
  const packageStep = macos.slice(packaging, upload);
  assert.doesNotMatch(packageStep, /EVS_ACCOUNT_NAME|EVS_PASSWD|--sign-vmp/);
  assert.match(packageStep, /app_dir=dist\/mac\n/);
  assert.match(packageStep, /app_dir=dist\/mac-arm64/);
  assert.match(packageStep, /pack-ecs\.mjs --prepackaged "\$app_dir\/EffeTune\.app" --output dist/);
  assert.ok(packageStep.indexOf('--prepackaged') < packageStep.indexOf('verify-pkg --streaming "$app_dir"'));
  assert.doesNotMatch(macos, /continue-on-error:|if: always\(\)/);

  const linux = jobBlock(workflows.build, 'build-linux');
  assert.match(linux, /node scripts\/prepare-ecs\.mjs/);
  assert.match(linux, /node scripts\/pack-ecs\.mjs --output dist/);
  assert.doesNotMatch(linux, /EVS_|castlabs_evs|--sign-vmp/);
});

test('Linux release signatures are required and verified before packaging and upload', () => {
  const linux = jobBlock(workflows.build, 'build-linux');
  const caller = jobBlock(workflows.desktopRelease, 'linux');
  for (const secret of ['APPIMAGE_GPG_PRIVATE_KEY', 'APPIMAGE_GPG_PASSPHRASE', 'APPIMAGE_GPG_KEY_FINGERPRINT']) {
    assert.ok(caller.includes(`${secret}: \${{ secrets.${secret} }}`));
    assert.match(workflows.build, new RegExp(`      ${secret}:\\s+description: [^\\n]+\\s+required: false`));
    for (const other of ['windows', 'macos']) {
      assert.doesNotMatch(jobBlock(workflows.desktopRelease, other), new RegExp(secret));
    }
    assert.doesNotMatch(workflows.ci, new RegExp(secret));
  }
  const signing = linux.indexOf('name: Sign and verify Linux AppImage');
  const packaging = linux.indexOf('name: Package Linux AppImage');
  const upload = linux.indexOf('name: Upload Linux artifacts');
  assert.ok(signing >= 0 && signing < packaging && packaging < upload);
  const signStep = linux.slice(signing, packaging);
  assert.doesNotMatch(signStep, /\n\s+if:|continue-on-error:/);
  assert.match(signStep, /GITHUB_REPOSITORY" != 'Frieve-A\/effetune'/);
  assert.match(signStep, /GITHUB_REF_TYPE" != 'tag'.*GITHUB_REF_NAME" != "v\$\{version\}"/);
  assert.match(signStep, /APPIMAGE_GPG_PRIVATE_KEY:\?Configure/);
  assert.match(signStep, /APPIMAGE_GPG_PASSPHRASE:\?Configure/);
  assert.match(signStep, /APPIMAGE_GPG_KEY_FINGERPRINT:\?Configure/);
  assert.match(signStep, /test "\$actual_fingerprint" = "\$fingerprint"/);
  assert.match(signStep, /--passphrase-fd 0/);
  assert.match(signStep, /--local-user "\$\{fingerprint\}!"/);
  assert.match(signStep, /gpgv --homedir "\$GNUPGHOME" --keyring "\$GNUPGHOME\/verification-keyring\.gpg"/);
  assert.match(signStep, /trap cleanup EXIT/);
  assert.match(signStep, /gpgconf --homedir "\$GNUPGHOME" --kill all/);
  assert.match(signStep, /rm -rf -- "\$GNUPGHOME"/);
  assert.match(linux.slice(packaging, upload), /"\$\{appimage\}\.asc" \\\n\s+EffeTune-AppImage-signing-key\.asc/);
  assert.doesNotMatch(linux, /continue-on-error:|if: always\(\)/);
});

test('all desktop packages include native runtimes and their tracked notices', () => {
  for (const platform of ['win', 'mac', 'linux']) {
    const resources = packageJson.build[platform].extraResources;
    assert.ok(Array.isArray(resources), `${platform} package must define extraResources`);
    const destinations = resources.map(resource => resource.to).sort();
    const expectedDestinations = [
      'airplay',
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

const ohNetSizeFormats = [
  [
    'OpenHome/Net/Device/DviService.cpp',
    'Log::Print(", refCount=%u, subscriptions=%u\\n", iRefCount, iSubscriptions.size());',
    'Log::Print(", refCount=%u, subscriptions=%zu\\n", iRefCount, iSubscriptions.size());',
  ],
  [
    'OpenHome/Net/Device/DviSubscription.cpp',
    'summary.AppendPrintf("Subscriptions: %u current, %u since startup\\n", iMap.size(), iCount);',
    'summary.AppendPrintf("Subscriptions: %zu current, %u since startup\\n", iMap.size(), iCount);',
  ],
];

test('pinned ohNet size formats are corrected on fresh and reused extraction sources', t => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'effetune-ohnet-formats-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [relativePath, before] of ohNetSizeFormats) {
    const file = path.join(root, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '// preserved source\n' + before + '\n');
  }
  for (let application = 0; application < 2; application += 1) {
    patchOhNetSizeFormats(root);
    for (const [relativePath, , after] of ohNetSizeFormats) {
      assert.equal(readFileSync(path.join(root, relativePath), 'utf8'), '// preserved source\n' + after + '\n');
    }
  }
  const invocation = sidecarBuildScript.indexOf('  patchOhNetSizeFormats(ohNetRoot);');
  assert.ok(invocation > sidecarBuildScript.indexOf("  const ohNetRoot = roots.get('ohNet');"));
  assert.ok(invocation < sidecarBuildScript.indexOf('  let ohNetLibrary;'));
});

test('pinned ohNet size format corrections reject unexpected upstream source before writing', t => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'effetune-ohnet-formats-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (let invalid = 0; invalid < ohNetSizeFormats.length; invalid += 1) {
    const sourceRoot = path.join(root, String(invalid));
    for (const [index, [relativePath, before]] of ohNetSizeFormats.entries()) {
      const file = path.join(sourceRoot, relativePath);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, index === invalid ? '// unexpected upstream source\n' : before);
    }
    assert.throws(
      () => patchOhNetSizeFormats(sourceRoot),
      error => error.message.includes('Unexpected pinned ohNet size-format source') &&
        error.message.includes(ohNetSizeFormats[invalid][0])
    );
    for (const [index, [relativePath, before]] of ohNetSizeFormats.entries()) {
      assert.equal(
        readFileSync(path.join(sourceRoot, relativePath), 'utf8'),
        index === invalid ? '// unexpected upstream source\n' : before
      );
    }
  }
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
  assert.match(linux, /^\s+third_party_source_bundle: true$/m);
  assert.match(linux, /^\s+source_verified: true$/m);
  assert.match(linux, /^\s+release_artifacts: true$/m);

  const buildWindows = jobBlock(workflows.build, 'build-windows');
  const buildMacos = jobBlock(workflows.build, 'build-macos');
  assert.match(buildWindows, /node scripts\/pack-ecs\.mjs --prepackaged dist\/win-unpacked --output dist/);
  assert.match(buildMacos, /node scripts\/pack-ecs\.mjs --sign-vmp --output dist/);
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
  assert.match(workflows.desktopRelease, /ThirdParty-Source\.zip/);
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
