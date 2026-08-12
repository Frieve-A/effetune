import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { get as httpsGet } from 'node:https';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');

export const openHomeSidecarBuildContract = Object.freeze({
  output: 'native/openhome-sidecar/build/win32-x64/effetune-openhome-sidecar.exe',
  producer: 'scripts/build-openhome-sidecar.mjs',
  inputs: Object.freeze([
    'native/openhome-sidecar/CMakeLists.txt',
    'native/openhome-sidecar/dependencies.lock.json',
    'native/openhome-sidecar/src/main.cpp',
    'native/openhome-sidecar/src/protocol.cpp',
    'native/openhome-sidecar/src/protocol.h',
    'native/openhome-sidecar/src/providers.cpp',
    'native/openhome-sidecar/src/providers.h',
    'native/openhome-sidecar/tests/protocol_test.cpp',
    'tools/openhome-linux-provenance.mjs',
  ]),
});

const sidecarRoot = join(repositoryRoot, 'native', 'openhome-sidecar');
const cacheRoot = join(sidecarRoot, 'cache');
const sourceRoot = join(cacheRoot, 'src');
const buildRoot = join(sidecarRoot, 'build');
const cmakeBuildRoot = join(buildRoot, 'cmake');
const lockPath = join(sidecarRoot, 'dependencies.lock.json');

function quoteForCmd(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${basename(command)} exited with code ${result.status}.`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${basename(command)} exited with code ${result.status}.`);
  }
  return result.stdout.trim();
}

const LIBNL_SONAME = /^libnl(?:-genl)?-3\.so(?:\..+)?$/;

export function parseLinuxLibnlDependencies(output) {
  const dependencies = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(libnl(?:-genl)?-3\.so(?:\.[^\s]+)*)\s+=>\s+(\S+)/);
    if (!match) continue;
    if (match[2] === 'not') {
      throw new Error(`Linux loader could not resolve ${match[1]}.`);
    }
    dependencies.set(match[1], match[2]);
  }
  const names = [...dependencies.keys()];
  if (!names.some(name => name.startsWith('libnl-3.so.'))
      || !names.some(name => name.startsWith('libnl-genl-3.so.'))) {
    throw new Error('Linux OpenHome sidecar must resolve both libnl and libnl-genl at runtime.');
  }
  return dependencies;
}

function collectLinuxLibnlRuntime(executable, targetOutputRoot) {
  for (const entry of readdirSync(targetOutputRoot, { withFileTypes: true })) {
    if (entry.isFile() && LIBNL_SONAME.test(entry.name)) {
      rmSync(join(targetOutputRoot, entry.name));
    }
  }

  const systemDependencies = parseLinuxLibnlDependencies(capture('ldd', [executable]));
  const origins = [];
  for (const [soname, resolvedPath] of systemDependencies) {
    if (!resolvedPath.startsWith('/')) {
      throw new Error(`Linux loader returned a non-absolute path for ${soname}.`);
    }
    const canonicalSourcePath = realpathSync.native(resolvedPath);
    const packagedPath = join(targetOutputRoot, soname);
    copyFileSync(canonicalSourcePath, packagedPath);
    origins.push({
      soname,
      sourcePath: canonicalSourcePath,
      packagedFile: soname,
      sha256: sha256(packagedPath)
    });
  }
  writeFileSync(
    join(targetOutputRoot, 'libnl-runtime-origins.json'),
    `${JSON.stringify({ schemaVersion: 1, libraries: origins }, null, 2)}\n`,
    'utf8'
  );

  const dynamicSection = capture('readelf', ['-d', executable]);
  if (!/(?:RPATH|RUNPATH).*\[\$ORIGIN\]/.test(dynamicSection)) {
    throw new Error('Linux OpenHome sidecar must use $ORIGIN for runtime libraries.');
  }
  const packagedDependencies = parseLinuxLibnlDependencies(capture('ldd', [executable]));
  for (const [soname, resolvedPath] of packagedDependencies) {
    if (resolve(dirname(resolvedPath)) !== resolve(targetOutputRoot)) {
      throw new Error(`${soname} does not resolve beside the Linux OpenHome sidecar.`);
    }
  }
}

function runInVisualStudio(command, cwd, vsDevCmd) {
  const wrapper = join(buildRoot, `.vs-build-${process.pid}.cmd`);
  const contents = [
    '@echo off',
    `call ${quoteForCmd(vsDevCmd)} -arch=x64 -host_arch=x64 >nul`,
    'if errorlevel 1 exit /b %errorlevel%',
    command,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n');
  writeFileSync(wrapper, contents, { encoding: 'utf8', flag: 'w' });
  try {
    run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', wrapper], { cwd });
  } finally {
    rmSync(wrapper, { force: true });
  }
}

function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function assertInside(parent, candidate) {
  const child = relative(resolve(parent), resolve(candidate));
  if (child === '' || child.startsWith('..') || child.includes(':')) {
    throw new Error(`Refusing to modify a path outside ${parent}.`);
  }
}

function download(url, destination, redirects = 0) {
  if (redirects > 5) {
    return Promise.reject(new Error('Dependency download exceeded the redirect limit.'));
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    return Promise.reject(new Error('Dependency downloads must use HTTPS.'));
  }

  return new Promise((resolveDownload, rejectDownload) => {
    const request = httpsGet(parsed, { headers: { 'User-Agent': 'effetune-openhome-build' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirected = new URL(response.headers.location, parsed).toString();
        download(redirected, destination, redirects + 1).then(resolveDownload, rejectDownload);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        rejectDownload(new Error(`Dependency download returned HTTP ${response.statusCode}.`));
        return;
      }

      const output = createWriteStream(destination, { flags: 'wx' });
      response.pipe(output);
      output.on('finish', () => output.close(resolveDownload));
      output.on('error', rejectDownload);
      response.on('error', rejectDownload);
    });
    request.setTimeout(60_000, () => request.destroy(new Error('Dependency download timed out.')));
    request.on('error', rejectDownload);
  });
}

async function ensureArchive(entry) {
  const archivePath = join(cacheRoot, `${entry.name}-${entry.commit}.zip`);
  if (!existsSync(archivePath)) {
    const partialPath = `${archivePath}.partial-${process.pid}`;
    console.log(`Downloading ${entry.name} ${entry.commit}...`);
    try {
      await download(entry.url, partialPath);
      renameSync(partialPath, archivePath);
    } catch (error) {
      rmSync(partialPath, { force: true });
      throw error;
    }
  }

  const actualHash = sha256(archivePath);
  if (actualHash !== entry.sha256.toLowerCase()) {
    throw new Error(`${entry.name} archive SHA-256 does not match dependencies.lock.json.`);
  }
  return archivePath;
}

function extractArchive(entry, archivePath) {
  const destination = join(sourceRoot, `${entry.name}-${entry.commit}`);
  if (existsSync(destination)) {
    return destination;
  }

  const temporaryRoot = join(sourceRoot, `.extract-${entry.name}-${process.pid}`);
  assertInside(sourceRoot, temporaryRoot);
  rmSync(temporaryRoot, { recursive: true, force: true });
  mkdirSync(temporaryRoot, { recursive: true });
  try {
    run('cmake', ['-E', 'tar', 'xf', archivePath], { cwd: temporaryRoot });
    const extracted = join(temporaryRoot, `${entry.name}-${entry.commit}`);
    if (!existsSync(extracted)) {
      throw new Error(`${entry.name} archive has an unexpected top-level directory.`);
    }
    renameSync(extracted, destination);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  return destination;
}

function findVsDevCmd() {
  const candidates = [];
  if (process.env.VSINSTALLDIR) {
    candidates.push(join(process.env.VSINSTALLDIR, 'Common7', 'Tools', 'VsDevCmd.bat'));
  }
  candidates.push('C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\Tools\\VsDevCmd.bat');
  candidates.push('C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\Tools\\VsDevCmd.bat');
  candidates.push('C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\Tools\\VsDevCmd.bat');
  candidates.push('C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\Tools\\VsDevCmd.bat');
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const vswhere = join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (existsSync(vswhere)) {
    const result = spawnSync(vswhere, [
      '-latest',
      '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath',
    ], { encoding: 'utf8', windowsHide: true });
    if (result.status === 0 && result.stdout.trim()) {
      const candidate = join(result.stdout.trim(), 'Common7', 'Tools', 'VsDevCmd.bat');
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error('Visual Studio 2022 with the x64 C++ tools was not found.');
}

function cmakeDefinition(name, value) {
  return `-D${name}=${quoteForCmd(value)}`;
}

export function runHandshakeSmoke(executable, args = ['--stdio', '--loopback']) {
  return new Promise((resolveSmoke, rejectSmoke) => {
    const child = spawn(executable, args, {
      cwd: sidecarRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let ready = false;
    let settled = false;
    let parseError = null;
    const diagnostics = [];

    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        rejectSmoke(error);
      } else {
        resolveSmoke();
      }
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error('OpenHome sidecar handshake smoke timed out.'));
    }, 15_000);

    const handleLine = (line) => {
      if (!line) {
        return;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        parseError ??= new Error('OpenHome sidecar emitted invalid NDJSON during the handshake smoke.');
        child.kill();
        return;
      }
      if (message.type === 'diagnostic') {
        diagnostics.push(typeof message.code === 'string' ? message.code : JSON.stringify(message));
      }
      if (message.type === 'ready' && message.protocolVersion === 1 && !ready) {
        ready = true;
        child.stdin.write(`${JSON.stringify({
          type: 'state',
          snapshot: {
            protocolVersion: 1,
            source: 'Playlist',
            transportState: 'Stopped',
            repeat: false,
            shuffle: false,
            currentId: 0,
            currentIndex: 0,
            uri: '',
            metadata: '',
            duration: 0,
            seconds: 0,
            bitrate: 0,
            bitDepth: 0,
            sampleRate: 0,
            lossless: false,
            codecName: '',
            tracksMax: 1000,
            idArray: '',
            idArrayToken: 0,
            transportToken: 0,
            trackToken: 0,
            detailsToken: 0,
          },
        })}\n`);
        child.stdin.end(`${JSON.stringify({ type: 'shutdown' })}\n`);
      }
    };

    const drainStdout = (flush = false) => {
      for (;;) {
        const newline = stdout.indexOf('\n');
        if (newline < 0) {
          break;
        }
        const line = stdout.slice(0, newline).trimEnd();
        stdout = stdout.slice(newline + 1);
        handleLine(line);
      }
      if (flush && stdout.trim()) {
        handleLine(stdout.trimEnd());
        stdout = '';
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8192);
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      drainStdout();
    });
    child.on('error', finish);
    child.on('close', (code, signal) => {
      drainStdout(true);
      if (parseError) {
        finish(parseError);
      } else if (diagnostics.length > 0) {
        finish(new Error(
          `OpenHome sidecar handshake reported diagnostic(s): ${diagnostics.join(', ')}. ${stderr}`.trim()
        ));
      } else if (!ready) {
        finish(new Error(`OpenHome sidecar exited before ready (${code ?? signal}). ${stderr}`.trim()));
      } else if (code !== 0) {
        finish(new Error(`OpenHome sidecar smoke exited with code ${code}. ${stderr}`.trim()));
      } else {
        finish();
      }
    });

    child.stdin.write(`${JSON.stringify({
      type: 'configure',
      protocolVersion: 1,
      device: {
        friendlyName: 'EffeTune OpenHome Build Smoke',
        udn: 'uuid:8c531660-3f80-4cc6-8dca-e794034e1e18',
      },
    })}\n`);
  });
}

export function parseBuildOptions(args) {
  let architecture = process.arch;
  let publishDevelopment = true;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--arch') {
      architecture = args[index + 1];
      index += 1;
    } else if (argument.startsWith('--arch=')) {
      architecture = argument.slice('--arch='.length);
    } else if (argument === '--no-publish-development') {
      publishDevelopment = false;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!['x64', 'arm64'].includes(architecture)) {
    throw new Error('The OpenHome sidecar supports x64 and arm64 targets.');
  }
  return { architecture, publishDevelopment };
}

function validateTarget(platform, architecture) {
  if (!['win32', 'darwin', 'linux'].includes(platform)) {
    throw new Error(`The OpenHome sidecar does not support ${platform}.`);
  }
  if (platform === 'win32' && (process.arch !== 'x64' || architecture !== 'x64')) {
    throw new Error('The Windows OpenHome sidecar build requires Windows x64.');
  }
  if (platform === 'linux' && architecture !== process.arch) {
    throw new Error('Linux OpenHome sidecars must be built on their target architecture.');
  }
}

function posixOhNetLibrary(ohNetRoot, platform, architecture) {
  if (platform === 'darwin') {
    return join(ohNetRoot, 'Build', 'Obj', `Mac-${architecture}`, 'Release', 'libohNetCore.a');
  }
  return join(ohNetRoot, 'Build', 'Obj', 'Posix', 'Release', 'libohNetCore.a');
}

export function posixOhNetMakeArgs(platform, architecture) {
  const args = ['ohNetCore', 'rsync=no'];
  if (platform === 'darwin') {
    args.push('cp=cp');
    if (architecture === 'x64') args.push('Mac-x64=1');
  }
  return args;
}

async function main() {
  const { architecture, publishDevelopment } = parseBuildOptions(process.argv.slice(2));
  validateTarget(process.platform, architecture);
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.archives)) {
    throw new Error('The OpenHome dependency lock has an unsupported format.');
  }

  mkdirSync(cacheRoot, { recursive: true });
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(buildRoot, { recursive: true });

  const roots = new Map();
  for (const entry of lock.archives) {
    if (!entry.name || !entry.commit || !entry.url || !/^[0-9a-f]{64}$/i.test(entry.sha256)) {
      throw new Error('The OpenHome dependency lock contains an invalid archive entry.');
    }
    const archivePath = await ensureArchive(entry);
    roots.set(entry.name, extractArchive(entry, archivePath));
  }

  const ohNetRoot = roots.get('ohNet');
  const generatedRoot = roots.get('ohNetGenerated');
  if (!ohNetRoot || !generatedRoot) {
    throw new Error('The OpenHome dependency lock must include ohNet and ohNetGenerated.');
  }

  let ohNetLibrary;
  let vsDevCmd = null;
  if (process.platform === 'win32') {
    vsDevCmd = findVsDevCmd();
    console.log('Building pinned ohNetCore (Release, x64, /MT)...');
    runInVisualStudio(
      'set "CL=/utf-8" && nmake /f OhNet.mak openhome_architecture=x64 ohNetCore',
      ohNetRoot,
      vsDevCmd
    );
    ohNetLibrary = join(ohNetRoot, 'Build', 'Obj', 'Windows', 'Release', 'ohNetCore.lib');
  } else {
    console.log(`Building pinned ohNetCore (Release, ${architecture})...`);
    const makeArgs = posixOhNetMakeArgs(process.platform, architecture);
    let makeEnvironment = process.env;
    if (process.platform === 'linux') {
      const libnlCflags = capture('pkg-config', [
        '--cflags-only-I',
        'libnl-3.0',
        'libnl-genl-3.0',
      ]);
      makeArgs.push('requirelibnl=');
      makeEnvironment = {
        ...process.env,
        CFLAGS: [process.env.CFLAGS, libnlCflags].filter(Boolean).join(' '),
      };
    }
    run('make', makeArgs, { cwd: ohNetRoot, env: makeEnvironment });
    ohNetLibrary = posixOhNetLibrary(ohNetRoot, process.platform, architecture);
  }
  if (!existsSync(ohNetLibrary)) {
    throw new Error('The pinned dependency build did not produce ohNetCore.');
  }

  console.log('Configuring OpenHome sidecar...');
  const targetBuildRoot = `${cmakeBuildRoot}-${process.platform}-${architecture}`;
  const targetOutputRoot = join(buildRoot, `${process.platform}-${architecture}`);
  const definitions = [
    '-DCMAKE_BUILD_TYPE=Release',
    `-DOHNET_ROOT=${ohNetRoot}`,
    `-DOHNET_GENERATED_ROOT=${generatedRoot}`,
    `-DOHNET_LIBRARY=${ohNetLibrary}`,
    `-DSIDECAR_OUTPUT_DIRECTORY=${targetOutputRoot}`,
  ];
  if (process.platform === 'darwin') {
    definitions.push(`-DCMAKE_OSX_ARCHITECTURES=${architecture === 'x64' ? 'x86_64' : 'arm64'}`);
  }
  if (process.platform === 'win32') {
    const configure = [
      `cmake -S ${quoteForCmd(sidecarRoot)}`,
      `-B ${quoteForCmd(targetBuildRoot)}`,
      '-G "NMake Makefiles"',
      ...definitions.map(definition => definition.startsWith('-D')
        ? cmakeDefinition(...definition.slice(2).split(/=(.*)/s, 2))
        : definition),
    ].join(' ');
    runInVisualStudio(configure, repositoryRoot, vsDevCmd);
  } else {
    run('cmake', ['-S', sidecarRoot, '-B', targetBuildRoot, ...definitions]);
  }

  console.log('Building OpenHome sidecar...');
  if (process.platform === 'win32') {
    runInVisualStudio(`cmake --build ${quoteForCmd(targetBuildRoot)}`, repositoryRoot, vsDevCmd);
  } else {
    run('cmake', ['--build', targetBuildRoot]);
  }

  console.log('Running OpenHome protocol tests...');
  if (process.platform === 'win32') {
    runInVisualStudio(
      `ctest --test-dir ${quoteForCmd(targetBuildRoot)} --output-on-failure`,
      repositoryRoot,
      vsDevCmd
    );
  } else {
    run('ctest', ['--test-dir', targetBuildRoot, '--output-on-failure']);
  }

  const executableName = process.platform === 'win32'
    ? 'effetune-openhome-sidecar.exe'
    : 'effetune-openhome-sidecar';
  const executable = join(targetOutputRoot, executableName);
  if (!existsSync(executable)) {
    throw new Error('The OpenHome sidecar executable was not produced at the expected path.');
  }

  if (process.platform === 'linux') {
    console.log('Collecting loader-resolved libnl runtime libraries...');
    collectLinuxLibnlRuntime(executable, targetOutputRoot);
    console.log('Recording exact libnl package provenance...');
    run(process.execPath, [join(repositoryRoot, 'tools', 'openhome-linux-provenance.mjs')]);
  }

  console.log('Running OpenHome sidecar handshake smoke...');
  await runHandshakeSmoke(executable);
  if (publishDevelopment) {
    const developmentExecutable = join(buildRoot, executableName);
    copyFileSync(executable, developmentExecutable);
  }
  console.log(`OpenHome sidecar build complete: ${executable}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
