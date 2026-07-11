import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  createVsEnvironmentInvocation,
  emscriptenExecutableName
} from '../../scripts/build-dsp-wasm.mjs';

test('DSP build invokes tools without placing dynamic paths in shell input', () => {
  assert.equal(emscriptenExecutableName('emcc', true), 'emcc.exe');
  assert.equal(emscriptenExecutableName('emcmake', true), 'emcmake.exe');
  assert.equal(emscriptenExecutableName('emcc', false), 'emcc');

  const vsDevCmd = path.join(
    path.parse(process.cwd()).root,
    'Visual Studio & Tools',
    'Common7',
    'Tools',
    'VsDevCmd.bat'
  );
  const invocation = createVsEnvironmentInvocation(vsDevCmd);

  assert.equal(invocation.command, 'cmd.exe');
  assert.deepEqual(invocation.args, [
    '/d', '/s', '/c',
    'call VsDevCmd.bat -arch=x64 -host_arch=x64 >nul && set'
  ]);
  assert.equal(invocation.cwd, path.dirname(vsDevCmd));
  assert.equal(invocation.args.some(argument => argument.includes('Visual Studio & Tools')), false);
  assert.equal(Object.hasOwn(invocation, 'shell'), false);
});
