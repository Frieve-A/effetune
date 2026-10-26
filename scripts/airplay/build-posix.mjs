import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { parseDpkgSearch, parseDpkgRecord, parseDscChecksums } from '../../tools/openhome-linux-provenance.mjs';

const SOURCE_BASES = ['libffi', 'pcre2', 'zlib', 'libiconv', 'gettext', 'glib2', 'openssl', 'libplist',
  'ffmpeg', 'gstreamer', 'gst-plugins-base', 'gst-plugins-good', 'gst-plugins-bad', 'gst-libav'];
const BASE_ELF = /^(?:ld-linux[^/]*|lib(?:c|m|pthread|rt|dl|util|resolv)\.so(?:\..*)?)$/;
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');

export function parseLinuxDependencies(output) {
  if (/=>\s+not found(?:\s|$)/m.test(output)) throw new Error('Unresolved AirPlay ELF dependency');
  return [...output.matchAll(/^\s*(\S+)\s+=>\s+(\/\S+)\s+\(/gm)]
    .filter(match => !BASE_ELF.test(match[1]))
    .map(match => ({ name: match[1], path: match[2] }));
}

export function parseMacDependencies(output) {
  return output.split('\n').slice(1).map(line => line.trim().split(' (')[0])
    .filter(name => name && !name.startsWith('/usr/lib/') && !name.startsWith('/System/Library/'));
}

export function parseMacRpaths(output) {
  return [...output.matchAll(/cmd LC_RPATH\n\s+cmdsize \d+\n\s+path ([^\n]+) \(offset \d+\)/g)].map(match => match[1]);
}

export function patchPosixUxplay(sourceRoot) {
  // The upstream macOS defaults replace private pkg-config paths with developer installations.
  for (const directory of ['lib', 'renderers']) {
    const file = join(sourceRoot, directory, 'CMakeLists.txt');
    const source = readFileSync(file, 'utf8');
    const updated = source.split('\n').filter(line => !line.includes('set( ENV{PKG_CONFIG_PATH}') &&
      !line.includes('set(PKG_CONFIG_EXECUTABLE ${PKG_CONFIG_EXECUTABLE} --define-prefix')).join('\n');
    writeFileSync(file, updated);
  }
}

async function preparePrivateSources({ lock, buildRoot, downloadLockedArchive, run }) {
  const sources = {};
  const archives = [];
  for (const base of SOURCE_BASES) {
    const entry = lock.windowsSources.find(item => item.name.startsWith(`mingw-w64-${base}-`));
    if (!entry) throw new Error(`Missing locked AirPlay source: ${base}`);
    const archive = join(buildRoot, 'source-cache', entry.name);
    await downloadLockedArchive(entry.url, archive, entry.sha256);
    const directory = join(buildRoot, 'posix-sources', base);
    mkdirSync(directory, { recursive: true });
    const wrapper = join(directory, 'source-wrapper.tar');
    writeFileSync(wrapper, zstdDecompressSync(readFileSync(archive)));
    run('cmake', ['-E', 'tar', 'xf', wrapper], { cwd: directory });
    const packageRoot = join(directory, `mingw-w64-${base}`);
    const tarballs = readdirSync(packageRoot).filter(name => /\.tar\.(?:xz|gz|bz2|lz)$/.test(name));
    if (tarballs.length !== 1) throw new Error(`Ambiguous upstream AirPlay source: ${base}`);
    const upstream = join(directory, 'upstream');
    mkdirSync(upstream, { recursive: true });
    run('cmake', ['-E', 'tar', 'xf', join(packageRoot, tarballs[0])], { cwd: upstream });
    const roots = readdirSync(upstream).filter(name => statSync(join(upstream, name)).isDirectory());
    if (roots.length !== 1) throw new Error(`Invalid upstream AirPlay source layout: ${base}`);
    sources[base] = join(upstream, roots[0]);
    archives.push({ ...entry, file: entry.name });
  }
  return { sources, archives };
}

function buildPrivateLibraries({ platform, architecture, prefix, workRoot, sources, lock, run, env }) {
  const jobs = String(Math.min(availableParallelism(), 4));
  const configureSource = (executable, args, build) => {
    const marker = join(build, 'effetune-config.json');
    const signature = JSON.stringify({ executable, args, CFLAGS: env.CFLAGS, CPPFLAGS: env.CPPFLAGS, LDFLAGS: env.LDFLAGS });
    if (existsSync(join(build, 'Makefile')) && existsSync(marker) && readFileSync(marker, 'utf8') === signature) return;
    run(executable, args, { cwd: build, env });
    writeFileSync(marker, signature);
  };
  const make = (source, name, args, configureFile = 'configure') => {
    const build = join(workRoot, name);
    mkdirSync(build, { recursive: true });
    configureSource('/bin/sh', [join(source, configureFile), `--prefix=${prefix}`, `--libdir=${join(prefix, 'lib')}`, ...args], build);
    run('make', ['-j', jobs], { cwd: build, env });
    run('make', ['install'], { cwd: build, env });
  };
  const meson = (name, args = []) => {
    const build = join(workRoot, name);
    run('meson', ['setup', ...(existsSync(join(build, 'meson-private', 'coredata.dat')) ? ['--reconfigure'] : []),
      build, sources[name], `--prefix=${prefix}`, '--libdir=lib',
      '--buildtype=release', '--auto-features=disabled', '--wrap-mode=nodownload', '-Ddefault_library=shared', ...args], { env });
    run('meson', ['compile', '-C', build, '-j', jobs], { env });
    run('meson', ['install', '-C', build], { env });
  };
  make(sources.libffi, 'libffi', ['--disable-static', '--disable-docs']);
  make(sources.pcre2, 'pcre2', ['--enable-shared', '--disable-static', '--disable-pcre2grep', '--disable-pcre2test']);
  if (platform === 'darwin') {
    make(sources.libiconv, 'libiconv', ['--disable-static']);
    make(join(sources.gettext, 'gettext-runtime'), 'gettext-runtime', ['--disable-static', '--disable-libasprintf',
      `--with-libiconv-prefix=${prefix}`]);
  }
  const zlibBuild = join(workRoot, 'zlib');
  run('cmake', ['-S', sources.zlib, '-B', zlibBuild, '-DCMAKE_BUILD_TYPE=Release', `-DCMAKE_INSTALL_PREFIX=${prefix}`,
    '-DCMAKE_INSTALL_LIBDIR=lib', '-DZLIB_BUILD_EXAMPLES=OFF'], { env });
  run('cmake', ['--build', zlibBuild, '--parallel', jobs], { env });
  run('cmake', ['--install', zlibBuild], { env });
  meson('glib2', ['-Dtests=false', '-Dinstalled_tests=false', '-Dnls=disabled', '-Dintrospection=disabled']);
  const opensslBuild = join(workRoot, 'openssl');
  mkdirSync(opensslBuild, { recursive: true });
  const target = platform === 'darwin' ? (architecture === 'arm64' ? 'darwin64-arm64-cc' : 'darwin64-x86_64-cc') : 'linux-x86_64';
  configureSource('perl', [join(sources.openssl, 'Configure'), target, 'shared', 'no-tests',
    `--prefix=${prefix}`, '--libdir=lib'], opensslBuild);
  run('make', ['-j', jobs], { cwd: opensslBuild, env });
  run('make', ['install_sw'], { cwd: opensslBuild, env });
  make(sources.libplist, 'libplist', ['--without-cython', '--without-tools', '--without-tests',
    platform === 'darwin' ? '--enable-static' : '--disable-static']);
  make(sources.ffmpeg, 'ffmpeg', [...lock.codec.configure], 'configure');
  meson('gstreamer');
  meson('gst-plugins-base', ['-Dapp=enabled', '-Daudioconvert=enabled', '-Daudioresample=enabled',
    '-Dplayback=enabled', '-Dvolume=enabled']);
  meson('gst-plugins-good', ['-Drtp=enabled', '-Dudp=enabled', '-Dautodetect=enabled']);
  meson('gst-plugins-bad', ['-Dvideoparsers=enabled']);
  meson('gst-libav');
}

function collectRuntime({ platform, prefix, outputRoot, roots, run, env }) {
  const queue = [...roots];
  const copied = new Map();
  while (queue.length) {
    const item = queue.shift();
    if (copied.has(item.name)) {
      if (digest(copied.get(item.name).path) !== digest(item.path)) throw new Error(`Conflicting AirPlay dependency: ${item.name}`);
      continue;
    }
    const output = join(outputRoot, item.name);
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(item.path, output);
    copied.set(item.name, item);
    if (platform === 'linux') {
      for (const dependency of parseLinuxDependencies(run('ldd', [item.path], { env }))) {
        queue.push({ ...dependency, name: `lib/${dependency.name}` });
      }
    } else {
      const dependencies = parseMacDependencies(run('otool', ['-L', item.path], { env }));
      for (const dependency of dependencies) {
        const source = dependency.startsWith('@loader_path/')
          ? resolve(dirname(item.path), dependency.slice('@loader_path/'.length))
          : dependency.startsWith('@rpath/') ? join(prefix, 'lib', basename(dependency)) : dependency;
        if (!isAbsolute(source) || !realpathSync(source).startsWith(`${realpathSync(prefix)}/`)) {
          throw new Error(`AirPlay dependency is outside the private build: ${dependency}`);
        }
        const name = `lib/${basename(dependency)}`;
        if (realpathSync(source) !== realpathSync(item.path)) queue.push({ path: source, name });
      }
      item.macDependencies = dependencies;
    }
  }
  for (const [name, item] of copied) {
    const output = join(outputRoot, name);
    if (platform === 'linux') {
      run('patchelf', ['--set-rpath', name.startsWith('plugins/') ? '$ORIGIN/../lib' : name.startsWith('lib/') ? '$ORIGIN' : '$ORIGIN/lib', output]);
    } else {
      for (const dependency of item.macDependencies) {
        const target = name.startsWith('plugins/') ? `@loader_path/../lib/${basename(dependency)}`
          : name.startsWith('lib/') ? `@loader_path/${basename(dependency)}` : `@loader_path/lib/${basename(dependency)}`;
        run('install_name_tool', ['-change', dependency, target, output]);
      }
      if (name.startsWith('lib/') || name.startsWith('plugins/')) {
        run('install_name_tool', ['-id', `@rpath/${basename(name)}`, output]);
      }
      for (const rpath of parseMacRpaths(run('otool', ['-l', output]))) {
        if (isAbsolute(rpath)) run('install_name_tool', ['-delete_rpath', rpath, output]);
      }
      // Loader edits invalidate any old signature; Electron packaging applies the release identity later.
      run('codesign', ['--force', '--sign', '-', output]);
    }
  }
  return [...copied.values()];
}

function collectLinuxSources({ libraries, prefix, outputRoot, run, linuxSysroot }) {
  const packages = new Map();
  const sources = [];
  const origins = linuxSysroot ? JSON.parse(readFileSync(join(linuxSysroot, 'origins.json'), 'utf8')).libraries : [];
  for (const library of libraries.filter(item => item.name.startsWith('lib/') &&
      !realpathSync(item.path).startsWith(`${realpathSync(prefix)}/`))) {
    const sourcePath = realpathSync(library.path);
    const origin = origins.find(item => existsSync(item.path) && realpathSync(item.path) === sourcePath);
    const binary = origin?.binaryPackage || parseDpkgSearch(run('dpkg-query', ['--search', `*/${basename(sourcePath)}`]), sourcePath);
    const record = origin ? { binaryPackage: origin.binaryPackage, version: origin.version, architecture: origin.architecture,
      sourcePackage: origin.sourcePackage, sourceVersion: origin.sourceVersion } : parseDpkgRecord(run('dpkg-query', ['--show',
      '--showformat=${binary:Package}\t${Version}\t${Architecture}\t${source:Package}\t${source:Version}', binary]));
    packages.set(`${record.sourcePackage}=${record.sourceVersion}`, record);
    const packageName = record.binaryPackage.replace(/:[^:]+$/, '');
    const notice = join(origin ? linuxSysroot : '/', 'usr/share/doc', packageName, 'copyright');
    if (!existsSync(notice)) throw new Error(`Missing Debian copyright notice: ${binary}`);
    mkdirSync(join(outputRoot, 'licenses', 'debian'), { recursive: true });
    copyFileSync(notice, join(outputRoot, 'licenses', 'debian', `${packageName}.copyright`));
  }
  for (const [specification, record] of packages) {
    const sourceName = `${record.sourcePackage}-${encodeURIComponent(record.sourceVersion)}`;
    const sourceDirectory = join(outputRoot, 'source', 'debian', sourceName);
    mkdirSync(sourceDirectory, { recursive: true });
    run('apt-get', ['source', '--download-only', '--only-source', specification], { cwd: sourceDirectory });
    const dsc = readdirSync(sourceDirectory).find(name => name.endsWith('.dsc'));
    if (!dsc) throw new Error(`Missing Debian source descriptor: ${specification}`);
    const descriptor = readFileSync(join(sourceDirectory, dsc), 'utf8');
    sources.push({ name: dsc, file: `debian/${sourceName}/${dsc}`, sha256: digest(join(sourceDirectory, dsc)) });
    for (const file of parseDscChecksums(descriptor)) {
      if (basename(file.fileName) !== file.fileName || digest(join(sourceDirectory, file.fileName)) !== file.sha256 ||
          statSync(join(sourceDirectory, file.fileName)).size !== file.size) {
        throw new Error(`Invalid Debian corresponding source: ${specification}`);
      }
      sources.push({ name: file.fileName, file: `debian/${sourceName}/${file.fileName}`, sha256: file.sha256 });
    }
  }
  return { packages: [...packages.values()], sources };
}

export async function buildPosixAirPlay({ platform, architecture, root, buildRoot, outputRoot, lock,
  sourceRoots, run, downloadLockedArchive, plugins, linuxSysroot = null }) {
  if (platform !== process.platform || architecture !== process.arch ||
      !(platform === 'linux' && architecture === 'x64' || platform === 'darwin' && ['x64', 'arm64'].includes(architecture))) {
    throw new Error('Build the AirPlay receiver on a matching supported target host');
  }
  if (dirname(resolve(outputRoot)) !== resolve(buildRoot)) throw new Error('Invalid AirPlay output directory');
  const { sources, archives } = await preparePrivateSources({ lock, buildRoot, downloadLockedArchive, run });
  const workRoot = join(buildRoot, `posix-build-${platform}-${architecture}`);
  const prefix = join(workRoot, 'prefix');
  mkdirSync(prefix, { recursive: true });
  const sysrootLibraries = linuxSysroot ? [join(linuxSysroot, 'usr', 'lib', 'x86_64-linux-gnu'), join(linuxSysroot, 'lib', 'x86_64-linux-gnu')] : [];
  const env = { ...process.env, PATH: `${join(prefix, 'bin')}:${process.env.PATH}`,
    PKG_CONFIG_PATH: [join(prefix, 'lib', 'pkgconfig'), ...sysrootLibraries.map(directory => join(directory, 'pkgconfig'))].join(':'),
    CFLAGS: '-O2', CXXFLAGS: '-O2', CPPFLAGS: `-I${join(prefix, 'include')}`,
    LDFLAGS: `-L${join(prefix, 'lib')}`, LD_LIBRARY_PATH: [join(prefix, 'lib'), ...sysrootLibraries].join(':') };
  if (platform === 'darwin') {
    env.PKG_CONFIG_LIBDIR = join(prefix, 'lib', 'pkgconfig');
    env.MACOSX_DEPLOYMENT_TARGET = '13.0';
  }
  buildPrivateLibraries({ platform, architecture, prefix, workRoot, sources, lock, run, env });
  patchPosixUxplay(sourceRoots.uxplay);
  const cmake = (source, name) => {
    const build = join(workRoot, name);
    run('cmake', ['-S', source, '-B', build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
      `-DCMAKE_PREFIX_PATH=${prefix}${linuxSysroot ? `;${join(linuxSysroot, 'usr')}` : ''}`,
      `-DCMAKE_LIBRARY_PATH=${sysrootLibraries.join(';')}`, `-DOPENSSL_ROOT_DIR=${prefix}`, '-DNO_MARCH_NATIVE=ON',
      '-DNO_X11_DEPS=ON', '-DCMAKE_INSTALL_RPATH_USE_LINK_PATH=OFF',
      ...(platform === 'darwin' ? ['-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0', '-DCMAKE_EXE_LINKER_FLAGS=-Wl,-headerpad_max_install_names'] : [])], { env });
    run('cmake', ['--build', build, '--parallel', '4'], { env });
    return build;
  };
  const uxplayBuild = cmake(sourceRoots.uxplay, 'uxplay');
  const probeBuild = cmake(join(root, 'native', 'airplay-receiver'), 'probe');
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  const extension = platform === 'darwin' ? 'dylib' : 'so';
  const roots = [{ path: join(uxplayBuild, 'uxplay'), name: 'uxplay' },
    { path: join(probeBuild, 'airplay-package-probe'), name: 'airplay-package-probe' },
    ...plugins.map(name => ({ path: join(prefix, 'lib', 'gstreamer-1.0', `libgst${name}.${extension}`), name: `plugins/libgst${name}.${extension}` }))];
  const libraries = collectRuntime({ platform, prefix, outputRoot, roots, run, env });
  const provenance = platform === 'linux' ? collectLinuxSources({ libraries, prefix, outputRoot, run, linuxSysroot }) : { packages: [], sources: [] };
  const sourceOutput = join(outputRoot, 'source');
  mkdirSync(sourceOutput, { recursive: true });
  for (const archive of archives) copyFileSync(join(buildRoot, 'source-cache', archive.file), join(sourceOutput, archive.file));
  const uxplay = lock.archives.find(entry => entry.name === 'uxplay');
  const uxplayArchive = join(buildRoot, 'source-cache', `uxplay-${uxplay.commit}.zip`);
  copyFileSync(uxplayArchive, join(sourceOutput, basename(uxplayArchive)));
  for (const [name, source] of Object.entries({ ...sources, uxplay: sourceRoots.uxplay })) {
    const notices = readdirSync(source).filter(file => /^(?:LICEN[CS]E|COPYING|COPYRIGHT)(?:[.-].*)?$/i.test(file) && statSync(join(source, file)).isFile());
    if (!notices.length) throw new Error(`Missing AirPlay source license: ${name}`);
    mkdirSync(join(outputRoot, 'licenses', name), { recursive: true });
    for (const file of notices) copyFileSync(join(source, file), join(outputRoot, 'licenses', name, file));
  }
  const recipe = join(sourceOutput, 'effetune-airplay-build');
  cpSync(join(root, 'native', 'airplay-receiver'), join(recipe, 'native', 'airplay-receiver'), { recursive: true });
  mkdirSync(join(recipe, 'scripts', 'airplay'), { recursive: true });
  copyFileSync(join(root, 'scripts', 'build-airplay-receiver.mjs'), join(recipe, 'scripts', 'build-airplay-receiver.mjs'));
  copyFileSync(join(root, 'scripts', 'airplay', 'build-posix.mjs'), join(recipe, 'scripts', 'airplay', 'build-posix.mjs'));
  mkdirSync(join(recipe, 'tools'), { recursive: true });
  copyFileSync(join(root, 'tools', 'openhome-linux-provenance.mjs'), join(recipe, 'tools', 'openhome-linux-provenance.mjs'));
  copyFileSync(join(root, 'native', 'airplay-receiver', 'THIRD_PARTY_NOTICES.txt'), join(outputRoot, 'THIRD_PARTY_NOTICES.txt'));
  writeFileSync(join(outputRoot, 'uxplay.conf'), '');
  const runtimeEnv = { ...process.env, PATH: '/usr/bin:/bin', LD_LIBRARY_PATH: '', DYLD_LIBRARY_PATH: '',
    GST_PLUGIN_SYSTEM_PATH_1_0: '', GST_PLUGIN_PATH_1_0: join(outputRoot, 'plugins'),
    GST_REGISTRY_FORK: 'no', GST_REGISTRY_1_0: join(workRoot, 'private-runtime-registry.bin') };
  run(join(outputRoot, 'uxplay'), ['-h'], { env: runtimeEnv });
  run(join(outputRoot, 'airplay-package-probe'), [], { env: runtimeEnv });
  writeFileSync(join(outputRoot, 'runtime-manifest.json'), `${JSON.stringify({
    schemaVersion: 1, platform, architecture, uxplayVersion: uxplay.version, uxplayCommit: uxplay.commit,
    sampleRate: 44100, channelCount: 2, format: 'S16BE', transport: 'RTP-L16', plugins,
    packages: provenance.packages, sources: [uxplay, ...archives, ...provenance.sources], files: libraries.map(item => item.name).sort()
  }, null, 2)}\n`);
  console.log(`Built AirPlay runtime: ${outputRoot}`);
}
