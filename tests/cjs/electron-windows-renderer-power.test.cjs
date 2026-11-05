const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createWindowsRendererPower } = require('../../electron/windows-renderer-power.cjs');

function helperProcess(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  return child;
}

function closeHelper(child, code = 0) {
  child.stdout.end();
  child.stderr.end();
  child.emit('exit', code, null);
  child.emit('close', code, null);
}

test('renderer power helper follows only the current main renderer and restores on mode change', async () => {
  let mode = 'continuous';
  let rendererPid = 41;
  const spawned = [];
  const diagnostics = [];
  const manager = createWindowsRendererPower({
    helperPath: 'owned-helper.exe',
    getConfig: () => ({ powerSaving: { mode } }),
    getRendererWebContents: () => ({ getOSProcessId: () => rendererPid }),
    onDiagnostic: (...args) => diagnostics.push(args),
    spawnProcess(_path, args, options) {
      assert.equal(options.windowsHide, true);
      const pid = Number(args[0]);
      const child = new EventEmitter();
      child.pid = pid + 1000;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = { end(text) {
        assert.equal(text, 'restore\n');
        queueMicrotask(() => {
          child.stdout.write(JSON.stringify({ event: 'restored', pid, creationTime: String(pid * 100),
            controlMask: 0, stateMask: 0, matched: true }) + '\n');
          setImmediate(() => { child.emit('exit', 0, null); child.emit('close', 0, null); });
        });
      } };
      spawned.push(pid);
      queueMicrotask(() => child.stdout.write(JSON.stringify({ event: 'applied', pid,
        creationTime: String(pid * 100), originalControl: 0, originalState: 0,
        controlMask: 1, stateMask: 0 }) + '\n'));
      return child;
    }
  });
  await manager.update(true);
  await manager.update(true);
  assert.deepEqual(spawned, [41]);
  assert.deepEqual(manager.status(), { applied: true, pid: 41, helperPid: 1041,
    creationTime: '4100',
    originalControl: 0, originalState: 0, controlMask: 1, stateMask: 0,
    processingActive: true });
  rendererPid = 42;
  await manager.update(true);
  assert.deepEqual(spawned, [41, 42]);
  mode = 'balanced';
  await manager.refreshConfig();
  assert.equal(manager.status().applied, false);
  assert.equal(manager.status().processingActive, true);

  mode = 'continuous';
  await manager.refreshConfig();
  assert.equal(manager.status().applied, true);
  await manager.stop();
  assert.equal(manager.status().applied, false);
  assert.equal(manager.status().restored, true);
  assert.equal(manager.status().processingActive, false);
  await manager.refreshConfig();
  assert.deepEqual(spawned, [41, 42, 42]);
  assert.deepEqual(diagnostics, []);
  await manager.dispose();
});

test('a missing native helper reports an unapplied policy without rejecting audio activity or shutdown', async () => {
  const diagnostics = [];
  const manager = createWindowsRendererPower({
    helperPath: 'missing-helper.exe',
    getConfig: () => ({ powerSaving: { mode: 'continuous' } }),
    getRendererWebContents: () => ({ getOSProcessId: () => 41 }),
    onDiagnostic: (...args) => diagnostics.push(args),
    spawnProcess() {
      const child = helperProcess(1001);
      queueMicrotask(() => {
        child.emit('error', Object.assign(new Error('Helper not found'), { code: 'ENOENT' }));
        closeHelper(child, -2);
      });
      return child;
    }
  });

  await manager.update(true);
  assert.deepEqual(manager.status(), {
    applied: false, pid: null, error: 'ENOENT', processingActive: true
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0][0], 'Renderer power helper could not apply HighQoS.');
  assert.equal(diagnostics[0][1].code, 'ENOENT');
  await manager.dispose();
  assert.equal(manager.status().processingActive, false);
});

test('helper crashes restore the saved policy and a replacement renderer can start and release its own helper', async () => {
  let rendererPid = 41;
  const calls = [];
  const diagnostics = [];
  const children = [];
  const manager = createWindowsRendererPower({
    helperPath: 'owned-helper.exe',
    getConfig: () => ({ powerSaving: { mode: 'continuous' } }),
    getRendererWebContents: () => ({ getOSProcessId: () => rendererPid }),
    onDiagnostic: (...args) => diagnostics.push(args),
    spawnProcess(file, args, options) {
      calls.push({ file, args, options });
      const child = helperProcess(1000 + calls.length);
      children.push(child);
      if (args[0] === '--restore') {
        queueMicrotask(() => {
          child.stdout.write(JSON.stringify({ event: 'restored', matched: true,
            controlMask: 0, stateMask: 1 }) + '\n');
          setImmediate(() => closeHelper(child));
        });
      } else {
        const pid = Number(args[0]);
        queueMicrotask(() => child.stdout.write(JSON.stringify({ event: 'applied', pid,
          creationTime: String(pid * 100), originalControl: 0, originalState: 1,
          controlMask: 1, stateMask: 0 }) + '\n'));
        child.stdin.once('finish', () => {
          child.stdout.write(JSON.stringify({ event: 'restored', matched: true,
            controlMask: 0, stateMask: 1 }) + '\n');
          setImmediate(() => closeHelper(child));
        });
      }
      return child;
    }
  });

  await manager.update(true);
  closeHelper(children[0], 1);
  await manager.update(true);
  assert.deepEqual(calls[1], {
    file: 'owned-helper.exe', args: ['--restore', '41', '4100', '0', '1'],
    options: { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  });
  assert.deepEqual(manager.status(), {
    applied: false, pid: 41, creationTime: '4100', controlMask: 0, stateMask: 1,
    restored: true, helperExitCode: 1, processingActive: true
  });
  await manager.update(true);
  assert.equal(calls.length, 2);

  rendererPid = 42;
  await manager.update(true);
  assert.deepEqual(calls[2].args, ['42']);
  assert.equal(manager.status().applied, true);
  await manager.dispose();
  assert.equal(children[2].stdin.read().toString(), 'restore\n');
  assert.deepEqual(manager.status(), {
    applied: false, pid: 42, creationTime: '4200', controlMask: 0, stateMask: 1,
    restored: true, helperExitCode: 0, processingActive: false
  });
  await manager.update(true);
  assert.equal(calls.length, 3);
  assert.deepEqual(diagnostics, []);
});

test('failed crash recovery remains visibly unverified and does not restart the failed renderer helper', async t => {
  for (const failure of ['unmatched-policy', 'missing-helper']) {
    await t.test(failure, async () => {
      const diagnostics = [];
      const children = [];
      const manager = createWindowsRendererPower({
        helperPath: 'owned-helper.exe',
        getConfig: () => ({ powerSaving: { mode: 'continuous' } }),
        getRendererWebContents: () => ({ getOSProcessId: () => 41 }),
        onDiagnostic: (...args) => diagnostics.push(args),
        spawnProcess(_file, args) {
          const child = helperProcess(1000 + children.length);
          children.push(child);
          queueMicrotask(() => {
            if (args[0] !== '--restore') {
              child.stdout.write(JSON.stringify({ event: 'applied', pid: 41,
                creationTime: '4100', originalControl: 0, originalState: 1,
                controlMask: 1, stateMask: 0 }) + '\n');
            } else if (failure === 'missing-helper') {
              child.emit('error', Object.assign(new Error('Helper not found'), { code: 'ENOENT' }));
              closeHelper(child, -2);
            } else {
              child.stdout.write(JSON.stringify({ event: 'restored', matched: false,
                controlMask: 1, stateMask: 0 }) + '\n');
              setImmediate(() => closeHelper(child));
            }
          });
          return child;
        }
      });

      await manager.update(true);
      closeHelper(children[0], 1);
      await manager.update(true);
      assert.deepEqual(manager.status(), {
        applied: false, pid: 41, restoreFailed: true, processingActive: true
      });
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0][0], failure === 'missing-helper'
        ? 'Renderer power helper recovery failed.' : 'Renderer power helper fallback restore failed.');
      await manager.update(true);
      assert.equal(children.length, 2);
      await manager.dispose();
    });
  }
});
