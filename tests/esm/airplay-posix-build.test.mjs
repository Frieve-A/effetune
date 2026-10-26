import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseLinuxDependencies, parseMacDependencies, parseMacRpaths, patchPosixUxplay } from '../../scripts/airplay/build-posix.mjs';

test('POSIX runtime discovery retains private dependencies and rejects unresolved ELF libraries', () => {
  assert.deepEqual(parseLinuxDependencies(`
    linux-vdso.so.1 (0x123)
    libgstreamer-1.0.so.0 => /private/lib/libgstreamer-1.0.so.0 (0x123)
    libavahi-client.so.3 => /usr/lib/libavahi-client.so.3 (0x123)
    libc.so.6 => /lib/libc.so.6 (0x123)
    libm.so.6 => /lib/libm.so.6 (0x123)
    /lib64/ld-linux-x86-64.so.2 (0x123)
  `), [
    { name: 'libgstreamer-1.0.so.0', path: '/private/lib/libgstreamer-1.0.so.0' },
    { name: 'libavahi-client.so.3', path: '/usr/lib/libavahi-client.so.3' }
  ]);
  assert.throws(() => parseLinuxDependencies('libgstreamer.so => not found'), /Unresolved/);
  assert.deepEqual(parseMacDependencies(`uxplay:
    /private/lib/libgstreamer.dylib (compatibility version 0.0.0, current version 0.0.0)
    @rpath/libglib.dylib (compatibility version 0.0.0, current version 0.0.0)
    /usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)
    /System/Library/Frameworks/Foundation.framework/Versions/C/Foundation (compatibility version 1.0.0, current version 1.0.0)
  `), ['/private/lib/libgstreamer.dylib', '@rpath/libglib.dylib']);
  assert.deepEqual(parseMacRpaths(`Load command 1
          cmd LC_RPATH
      cmdsize 48
         path /private/build/prefix/lib (offset 12)
Load command 2
          cmd LC_RPATH
      cmdsize 48
         path @loader_path/lib (offset 12)
  `), ['/private/build/prefix/lib', '@loader_path/lib']);
});

test('POSIX UxPlay patch preserves build logic while removing developer pkg-config overrides', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'effetune-airplay-posix-')));
  try {
    for (const directory of ['lib', 'renderers']) {
      mkdirSync(join(root, directory));
      writeFileSync(join(root, directory, 'CMakeLists.txt'), `if(APPLE)
  set( ENV{PKG_CONFIG_PATH} "/opt/homebrew/lib/pkgconfig" )
  set(PKG_CONFIG_EXECUTABLE \${PKG_CONFIG_EXECUTABLE} --define-prefix )
endif()
find_package(PkgConfig REQUIRED)
`);
    }
    patchPosixUxplay(root);
    const expected = 'if(APPLE)\nendif()\nfind_package(PkgConfig REQUIRED)\n';
    assert.equal(readFileSync(join(root, 'lib', 'CMakeLists.txt'), 'utf8'), expected);
    patchPosixUxplay(root);
    assert.equal(readFileSync(join(root, 'renderers', 'CMakeLists.txt'), 'utf8'), expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
