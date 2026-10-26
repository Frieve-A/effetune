import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = join(repositoryRoot, 'out', 'native', 'airplay-receiver');
const lock = JSON.parse(readFileSync(join(repositoryRoot, 'native', 'airplay-receiver', 'dependencies.lock.json')));

export function patchUxplayDiagnostics(sourceRoot) {
  const sourcePath = join(sourceRoot, 'uxplay.cpp');
  let source = readFileSync(sourcePath, 'utf8');
  // The fixed backend already counts its live connections. Make those two
  // existing observations available without packet-debug logging or buffering.
  source = source.replaceAll('LOGD("Open connections: %i", open_connections);',
    'LOGI("Open connections: %i", open_connections);');
  source = source.replace('printf("\\n");\n    va_end(vargs);',
    'printf("\\n");\n    fflush(stdout);\n    va_end(vargs);');
  const volumeObservation = '    printf("EFFETUNE_AIRPLAY_VOLUME {\\"fraction\\":%.9g}\\n", frac);\n    fflush(stdout);';
  if (!source.includes(volumeObservation)) {
    source = source.replace('    video_renderer_hls_set_volume(gst_volume);\n}',
      `    video_renderer_hls_set_volume(gst_volume);\n${volumeObservation}\n}`);
  }
  if (source.split('LOGI("Open connections: %i", open_connections);').length !== 3 ||
      !source.includes('printf("\\n");\n    fflush(stdout);\n    va_end(vargs);') ||
      !source.includes(volumeObservation)) {
    throw new Error('Pinned UxPlay lifecycle diagnostic patch did not match.');
  }
  writeFileSync(sourcePath, source);
}

export const AIRPLAY_GSTREAMER_PLUGINS = Object.freeze([
  'app', 'libav', 'playback', 'autodetect', 'videoparsersbad', 'audioconvert',
  'audioresample', 'volume', 'rtp', 'udp', 'coreelements'
]);

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${basename(executable)} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

export function collectWindowsRuntime(toolchain, outputRoot) {
  const ownership = JSON.parse(readFileSync(join(buildRoot, 'package-ownership.json')));
  const usedPackages = new Set();
  const queue = [
    [join(buildRoot, 'uxplay-build', 'uxplay.exe'), 'uxplay.exe'],
    [join(buildRoot, 'probe-build', 'airplay-package-probe.exe'), 'airplay-package-probe.exe'],
    [join(buildRoot, 'mdns-build', 'dnssd.dll'), 'dnssd.dll'],
    [join(buildRoot, 'mdns-build', 'mDNSResponder.exe'), 'discovery/mDNSResponder.exe'],
    ...AIRPLAY_GSTREAMER_PLUGINS.map(name => [
      join(toolchain, 'lib', 'gstreamer-1.0', `libgst${name}.dll`), `plugins/libgst${name}.dll`
    ])
  ];
  const copied = new Set();
  while (queue.length) {
    const [source, name] = queue.shift();
    if (copied.has(name.toLowerCase())) continue;
    const destination = join(outputRoot, name);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    copied.add(name.toLowerCase());
    const packagePath = `ucrt64/${source.slice(toolchain.length + 1).replaceAll('\\', '/')}`;
    if (ownership[packagePath]) usedPackages.add(ownership[packagePath]);
    if (source.startsWith(join(buildRoot, 'minimal-ffmpeg'))) {
      usedPackages.add('mingw-w64-ucrt-x86_64-ffmpeg');
    }
    const imports = run(join(toolchain, 'bin', 'objdump.exe'), ['-p', source]);
    for (const match of imports.matchAll(/DLL Name:\s*([^\r\n]+)/g)) {
      const dependency = match[1].trim();
      const codec = join(buildRoot, 'minimal-ffmpeg', 'bin', dependency);
      const bundled = existsSync(codec) ? codec : join(toolchain, 'bin', dependency);
      if (existsSync(bundled)) {
        queue.push([bundled, dependency]);
      } else if (!/^api-ms-win-|^ext-ms-win-/i.test(dependency) &&
                 !existsSync(join(process.env.SystemRoot, 'System32', dependency)) &&
                 dependency.toLowerCase() !== 'dnssd.dll') {
        throw new Error(`Unresolved AirPlay runtime dependency: ${dependency}`);
      }
    }
  }
  writeFileSync(join(outputRoot, 'uxplay.conf'), '');
  return { files: [...copied].sort(), packages: [...usedPackages].sort() };
}

export async function downloadLockedArchive(url, destination, sha256) {
  if (existsSync(destination) && digest(readFileSync(destination)) === sha256) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== sha256) throw new Error(`Archive checksum mismatch: ${url}`);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function extractPackage(bytes, destination, files = [], linksOnly = false) {
  const archive = zstdDecompressSync(bytes);
  const links = [];
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    if (!name) break;
    const prefix = header.subarray(345, 500).toString().replace(/\0.*$/s, '');
    const entry = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(header.subarray(124, 136).toString(), 8) || 0;
    const type = header[156];
    offset += 512;
    if (!linksOnly && entry.startsWith('ucrt64/') && !entry.includes('..') && !entry.includes('\\') &&
        (type === 0 || type === 48) && !entry.startsWith('ucrt64/share/doc/')) {
      const output = join(destination, ...entry.split('/'));
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, archive.subarray(offset, offset + size));
      files.push(entry);
    } else if (entry.startsWith('ucrt64/') && !entry.includes('..') && !entry.includes('\\') &&
               (type === 49 || type === 50)) {
      const target = header.subarray(157, 257).toString().replace(/\0.*$/s, '');
      const source = type === 49 ? resolve(destination, target) : resolve(destination, dirname(entry), target);
      if (!source.startsWith(`${resolve(destination)}\\`) && !source.startsWith(`${resolve(destination)}/`)) {
        throw new Error(`Package link escapes its installation root: ${entry}`);
      }
      links.push({ entry, source });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  for (const { entry, source } of links) {
    const output = join(destination, ...entry.split('/'));
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(source, output);
    files.push(entry);
  }
  return files;
}

async function fetchWindowsPackages() {
  const cacheRoot = join(buildRoot, 'package-cache');
  const toolchainRoot = join(buildRoot, 'toolchain');
  mkdirSync(cacheRoot, { recursive: true });
  const pending = lock.windowsPackages.filter(entry => !entry.sourceOnly);
  const ownership = {};
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let entry = pending.shift(); entry; entry = pending.shift()) {
      const archivePath = join(cacheRoot, entry.file);
      await downloadLockedArchive(`https://repo.msys2.org/mingw/ucrt64/${entry.file}`, archivePath, entry.sha256);
      const marker = join(cacheRoot, `${entry.file}.files.json`);
      const files = existsSync(marker) ? extractPackage(readFileSync(archivePath), toolchainRoot,
        JSON.parse(readFileSync(marker)), true) :
        extractPackage(readFileSync(archivePath), toolchainRoot);
      if (!existsSync(marker)) writeFileSync(marker, JSON.stringify(files));
      for (const file of files) ownership[file] = entry.name;
      console.log(`AirPlay dependency ready: ${entry.name} ${entry.version}`);
    }
  }));
  writeFileSync(join(buildRoot, 'package-ownership.json'), JSON.stringify(ownership));
  return join(toolchainRoot, 'ucrt64');
}

async function prepareSources() {
  const sources = {};
  for (const entry of lock.archives) {
    const cacheRoot = join(buildRoot, 'source-cache');
    const archive = join(cacheRoot, `${entry.name}-${entry.commit}.zip`);
    await downloadLockedArchive(entry.url, archive, entry.sha256);
    const sourceRoot = join(cacheRoot,
      `${entry.name === 'uxplay' ? 'UxPlay' : 'mDNSResponder'}-${entry.commit}`);
    if (!existsSync(sourceRoot)) run('cmake', ['-E', 'tar', 'xf', archive], { cwd: cacheRoot });
    sources[entry.name] = sourceRoot;
  }
  patchUxplayDiagnostics(sources.uxplay);
  return sources;
}

function buildMinimalWindowsCodec(toolchain) {
  const sourceRoot = join(buildRoot, 'codec-source');
  mkdirSync(sourceRoot, { recursive: true });
  const wrapperRoot = join(sourceRoot, lock.codec.sourceDirectory);
  const codecRoot = join(sourceRoot, `ffmpeg-${lock.codec.version}`);
  const sourceArchive = join(buildRoot, 'source-cache', lock.codec.sourceArchive);
  if (!existsSync(join(wrapperRoot, lock.codec.sourceTar))) {
    run('cmake', ['-E', 'tar', 'xf', sourceArchive], { cwd: sourceRoot });
  }
  if (!existsSync(join(codecRoot, 'configure'))) {
    run('cmake', ['-E', 'tar', 'xf', join(wrapperRoot, lock.codec.sourceTar)], { cwd: sourceRoot });
  }
  const bashOption = process.argv.indexOf('--bash');
  const bash = bashOption >= 0 ? process.argv[bashOption + 1] :
    join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe');
  const prefix = join(buildRoot, 'minimal-ffmpeg');
  const configuration = [
    `--prefix=${prefix.replaceAll('\\', '/')}`, '--target-os=mingw32', '--arch=x86_64',
    '--cc=gcc', '--cxx=g++', ...lock.codec.configure
  ];
  const markerPath = join(codecRoot, 'effetune-configuration.json');
  const marker = JSON.stringify(configuration);
  const environment = {
    ...process.env, PATH: `${join(toolchain, 'bin')};${join(dirname(dirname(bash)), 'usr', 'bin')};${process.env.PATH}`
  };
  if (!existsSync(markerPath) || readFileSync(markerPath, 'utf8') !== marker) {
    run(bash, ['--noprofile', '--norc', './configure', ...configuration], { cwd: codecRoot, env: environment });
    writeFileSync(markerPath, marker);
  }
  run(bash, ['--noprofile', '--norc', '-c', 'mingw32-make -j4 && mingw32-make install'],
    { cwd: codecRoot, env: environment });
}

function visualStudioEnvironment() {
  const vswhere = join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const installation = run(vswhere, ['-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']).trim();
  const command = join(installation, 'Common7', 'Tools', 'VsDevCmd.bat');
  if (!installation || /["%\r\n]/.test(command)) throw new Error('A standard Visual Studio C++ installation is required.');
  // This fixed shell boundary only imports the vendor compiler environment.
  // Build tools and source paths are subsequently passed as separate argv.
  const wrapper = join(buildRoot, `.vs-environment-${process.pid}.cmd`);
  writeFileSync(wrapper, `@echo off\r\ncall "${command}" -arch=x64 -host_arch=x64 >nul\r\nif errorlevel 1 exit /b %errorlevel%\r\nset\r\n`);
  let result;
  try {
    result = spawnSync('cmd.exe', ['/d', '/c', basename(wrapper)], {
      cwd: buildRoot, windowsHide: true, encoding: 'utf8'
    });
  } finally {
    rmSync(wrapper, { force: true });
  }
  if (result.error || result.status !== 0) throw new Error('Could not initialize the Visual Studio environment.');
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'path'));
  for (const line of result.stdout.split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0) environment[line.slice(0, index)] = line.slice(index + 1);
  }
  environment.CL = '/utf-8';
  return environment;
}

function buildWindowsDiscovery(sourceRoot) {
  const client = join(sourceRoot, 'mDNSShared', 'dnssd_clientstub.c');
  let contents = readFileSync(client, 'utf8');
  if (!contents.includes('#define LOG_ERR kDebugLevelError')) {
    contents = contents.replace('#define LOG_WARNING kDebugLevelWarning',
      '#define LOG_ERR kDebugLevelError\n    #define LOG_WARNING kDebugLevelWarning');
    if (!contents.includes('#define LOG_ERR kDebugLevelError')) throw new Error('DNS-SD Windows log mapping patch did not match.');
    writeFileSync(client, contents);
  }
  // Windows has no split AWDL resolver; its diagnostic observation is always false.
  const daemon = join(sourceRoot, 'mDNSShared', 'uds_daemon.c');
  contents = readFileSync(daemon, 'utf8');
  const awdlDiagnostic = '    const mDNSBool is_split_awdl_query = (req->resolve_awdl && question->InterfaceID == AWDLInterfaceID);';
  const windowsDiagnostic = '    const mDNSBool is_split_awdl_query = mDNSfalse;';
  if (!contents.includes(windowsDiagnostic)) {
    if (!contents.includes(awdlDiagnostic)) throw new Error('DNS-SD Windows AWDL diagnostic patch did not match.');
    writeFileSync(daemon, contents.replace(awdlDiagnostic, windowsDiagnostic));
  }
  const serviceProject = join(sourceRoot, 'mDNSWindows', 'SystemService', 'mDNSResponder.vcxproj');
  contents = readFileSync(serviceProject, 'utf8')
    .replaceAll('_LEGACY_NAT_TRAVERSAL_;', '')
    .replace('    <ClCompile Include="..\\..\\mDNSMacOSX\\LegacyNATTraversal.c" />', '');
  writeFileSync(serviceProject, contents);
  const environment = visualStudioEnvironment();
  const outputRoot = join(buildRoot, 'mdns-build');
  for (const [directory, project] of [['DLL', 'dnssd'], ['SystemService', 'mDNSResponder']]) {
    run('MSBuild.exe', [join(sourceRoot, 'mDNSWindows', directory, `${project}.vcxproj`),
      '/p:Configuration=Release', '/p:Platform=x64', `/p:OutDir=${outputRoot}\\`,
      `/p:IntDir=${join(outputRoot, `obj-${project}`)}\\`, '/p:DebugSymbols=false',
      '/p:DebugType=none', '/verbosity:quiet', '/nologo'], { env: environment });
  }
  const sdkRoot = join(buildRoot, 'bonjour-sdk');
  mkdirSync(join(sdkRoot, 'Include'), { recursive: true });
  mkdirSync(join(sdkRoot, 'Lib', 'x64'), { recursive: true });
  copyFileSync(join(sourceRoot, 'mDNSShared', 'dns_sd.h'), join(sdkRoot, 'Include', 'dns_sd.h'));
  copyFileSync(join(outputRoot, 'dnssd.lib'), join(sdkRoot, 'Lib', 'x64', 'dnssd.lib'));
  return sdkRoot;
}

async function packageWindowsSources(outputRoot, selection, sourceRoots) {
  const sourceOutput = join(outputRoot, 'source');
  mkdirSync(sourceOutput, { recursive: true });
  for (const entry of [...lock.archives, ...(lock.windowsSources || [])]) {
    const name = entry.file || (entry.commit ? `${entry.name}-${entry.commit}.zip` : entry.name);
    const source = join(buildRoot, 'source-cache', name);
    await downloadLockedArchive(entry.url, source, entry.sha256);
    copyFileSync(source, join(sourceOutput, name));
  }
  if (!lock.windowsSources?.length) throw new Error('The locked runtime corresponding-source list is missing.');
  const packages = lock.windowsPackages.filter(entry => selection.packages.includes(entry.name)).map(entry =>
    entry.sourceOnly ? { ...entry, rebuiltFromSource: true, license: 'LGPL-2.1-or-later', configure: lock.codec.configure } : entry);
  for (const entry of packages) {
    const sourceName = `${entry.base}-${entry.version.replace(/^\d+:/, '')}.src.tar.zst`;
    if (!lock.windowsSources.some(source => source.name === sourceName)) {
      throw new Error(`Missing matching corresponding source: ${entry.name}`);
    }
    const files = entry.sourceOnly ? [] : JSON.parse(readFileSync(join(buildRoot, 'package-cache', `${entry.file}.files.json`)));
    for (const file of files.filter(file => file.startsWith('ucrt64/share/licenses/'))) {
      const relative = file.slice('ucrt64/share/licenses/'.length);
      const destination = join(outputRoot, 'licenses', relative);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(buildRoot, 'toolchain', file), destination);
    }
  }
  mkdirSync(join(outputRoot, 'licenses'), { recursive: true });
  copyFileSync(join(sourceRoots.uxplay, 'LICENSE'), join(outputRoot, 'licenses', 'UxPlay-GPL-3.0.txt'));
  copyFileSync(join(sourceRoots.mdnsresponder, 'LICENSE'), join(outputRoot, 'licenses', 'mDNSResponder.txt'));
  cpSync(join(repositoryRoot, 'native', 'airplay-receiver', 'licenses'), join(outputRoot, 'licenses'), { recursive: true });
  copyFileSync(join(buildRoot, 'codec-source', `ffmpeg-${lock.codec.version}`, 'COPYING.LGPLv2.1'),
    join(outputRoot, 'licenses', 'FFmpeg-LGPL-2.1.txt'));
  const recipeRoot = join(sourceOutput, 'effetune-airplay-build');
  cpSync(join(repositoryRoot, 'native', 'airplay-receiver'), join(recipeRoot, 'native', 'airplay-receiver'), { recursive: true });
  mkdirSync(join(recipeRoot, 'scripts'), { recursive: true });
  mkdirSync(join(recipeRoot, 'scripts', 'airplay'), { recursive: true });
  mkdirSync(join(recipeRoot, 'electron'), { recursive: true });
  mkdirSync(join(recipeRoot, 'tools'), { recursive: true });
  copyFileSync(fileURLToPath(import.meta.url), join(recipeRoot, 'scripts', 'build-airplay-receiver.mjs'));
  copyFileSync(join(repositoryRoot, 'scripts', 'airplay', 'build-posix.mjs'),
    join(recipeRoot, 'scripts', 'airplay', 'build-posix.mjs'));
  copyFileSync(join(repositoryRoot, 'tools', 'openhome-linux-provenance.mjs'),
    join(recipeRoot, 'tools', 'openhome-linux-provenance.mjs'));
  copyFileSync(join(repositoryRoot, 'tools', 'verify-airplay-package.mjs'),
    join(recipeRoot, 'tools', 'verify-airplay-package.mjs'));
  copyFileSync(join(repositoryRoot, 'electron', 'airplay-discovery-installer.nsi'),
    join(recipeRoot, 'electron', 'airplay-discovery-installer.nsi'));
  copyFileSync(join(repositoryRoot, 'native', 'airplay-receiver', 'THIRD_PARTY_NOTICES.txt'),
    join(outputRoot, 'THIRD_PARTY_NOTICES.txt'));
  writeFileSync(join(outputRoot, 'runtime-manifest.json'), `${JSON.stringify({
    schemaVersion: 1, platform: 'win32', architecture: 'x64', uxplayVersion: '1.73.7',
    uxplayCommit: lock.archives[0].commit, sampleRate: 44100, channelCount: 2,
    format: 'S16BE', transport: 'RTP-L16', plugins: AIRPLAY_GSTREAMER_PLUGINS,
    packages, sources: [...lock.archives, ...lock.windowsSources], files: selection.files
  }, null, 2)}\n`);
}

async function buildWindows(outputRoot) {
  const sources = await prepareSources();
  const toolchain = await fetchWindowsPackages();
  const codecSource = lock.windowsSources.find(entry => entry.name === lock.codec.sourceArchive);
  if (!codecSource) throw new Error('The fixed FFmpeg source archive is missing from the lock.');
  await downloadLockedArchive(codecSource.url, join(buildRoot, 'source-cache', codecSource.name), codecSource.sha256);
  buildMinimalWindowsCodec(toolchain);
  const sdk = buildWindowsDiscovery(sources.mdnsresponder);
  const environment = {
    ...process.env, PATH: `${join(toolchain, 'bin')};${process.env.PATH}`,
    PKG_CONFIG_PATH: join(toolchain, 'lib', 'pkgconfig'), BONJOUR_SDK_HOME: sdk
  };
  const definitions = ['-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_C_COMPILER=${join(toolchain, 'bin', 'gcc.exe')}`,
    `-DCMAKE_CXX_COMPILER=${join(toolchain, 'bin', 'g++.exe')}`,
    `-DPKG_CONFIG_EXECUTABLE=${join(toolchain, 'bin', 'pkgconf.exe')}`];
  for (const [source, output, extra] of [
    [sources.uxplay, 'uxplay-build', ['-DNO_MARCH_NATIVE=ON', `-DOPENSSL_ROOT_DIR=${toolchain}`]],
    [join(repositoryRoot, 'native', 'airplay-receiver'), 'probe-build', []]
  ]) {
    run('cmake', ['-S', source, '-B', join(buildRoot, output), ...definitions, ...extra], { env: environment });
    run('cmake', ['--build', join(buildRoot, output), '--parallel', '4'], { env: environment });
  }
  const selection = collectWindowsRuntime(toolchain, outputRoot);
  await packageWindowsSources(outputRoot, selection, sources);
  const makensisOption = process.argv.indexOf('--makensis');
  const makensis = makensisOption >= 0 ? { path: process.argv[makensisOption + 1] } :
    await (await import('app-builder-lib/out/toolsets/windows.js')).getMakeNsisPath();
  run(makensis.path, [`/DAIRPLAY_DISCOVERY_DIR=${join(outputRoot, 'discovery')}`,
    `/DAIRPLAY_DISCOVERY_INSTALLER=${join(outputRoot, 'discovery', 'install-discovery.exe')}`,
    join(repositoryRoot, 'electron', 'airplay-discovery-installer.nsi')],
  { env: { ...process.env, ...makensis.env } });
  const { verifyAirplayRuntime } = await import('../tools/verify-airplay-package.mjs');
  verifyAirplayRuntime(outputRoot);
  console.log(`Built AirPlay runtime: ${outputRoot}`);
}

async function main() {
  if (process.argv.includes('--fetch-windows-packages')) {
    await fetchWindowsPackages();
    return;
  }
  const archIndex = process.argv.indexOf('--arch');
  const architecture = archIndex < 0 ? process.arch : process.argv[archIndex + 1];
  const outputIndex = process.argv.indexOf('--output-dir');
  const outputRoot = outputIndex < 0 ? join(buildRoot, `${process.platform}-${architecture}`) :
    resolve(process.argv[outputIndex + 1] || '');
  if (dirname(outputRoot) !== buildRoot) throw new Error('AirPlay output must be a direct child of the native build directory.');
  if (process.platform === 'win32' && architecture === 'x64') return await buildWindows(outputRoot);
  if (['linux', 'darwin'].includes(process.platform) && ['x64', 'arm64'].includes(architecture)) {
    const { buildPosixAirPlay } = await import('./airplay/build-posix.mjs');
    return await buildPosixAirPlay({ platform: process.platform, architecture,
      root: repositoryRoot, buildRoot, outputRoot,
      lock, sourceRoots: await prepareSources(), run, downloadLockedArchive,
      plugins: AIRPLAY_GSTREAMER_PLUGINS });
  }
  throw new Error('The AirPlay producer requires a supported target operating system and architecture.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
