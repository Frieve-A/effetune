const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');

const {
  QUIT_DEADLINE_DEFAULT_TIMEOUT_SECONDS,
  armQuitDeadline
} = require('../../electron/quit-deadline.cjs');

function fakeSpawn(calls) {
  return (command, args, options) => {
    const child = { unrefCalls: 0, handlers: {} };
    child.unref = () => { child.unrefCalls += 1; };
    child.on = (event, handler) => { child.handlers[event] = handler; };
    calls.push({ command, args, options, child });
    return child;
  };
}

test('quit deadline runs this executable as a detached Node helper that verifies the Windows process before killing it', () => {
  const calls = [];
  const armed = armQuitDeadline({
    pid: 4242,
    execPath: "C:\\Apps\\Frieve's\\EffeTune.exe",
    helperExecPath: 'C:\\Apps\\EffeTune\\EffeTune.exe',
    startedAt: 1700000000000,
    timeoutSeconds: 30,
    platform: 'win32',
    env: { PATH: 'x' },
    spawn: fakeSpawn(calls),
    logger: { error() {} }
  });

  assert.equal(calls.length, 1);
  const [{ command, args, options, child }] = calls;
  assert.equal(command, 'C:\\Apps\\EffeTune\\EffeTune.exe');
  assert.deepEqual(options, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { PATH: 'x', ELECTRON_RUN_AS_NODE: '1' }
  });
  assert.equal(child.unrefCalls, 1);
  assert.equal(args[0], '-e');
  const script = args[1];
  assert.ok(script.includes('const pid = 4242;'));
  assert.ok(script.includes(JSON.stringify("C:\\Apps\\Frieve's\\EffeTune.exe")));
  assert.ok(script.includes('}, 30000);'));
  assert.ok(script.includes('const poll = setInterval(() => {'));
  assert.ok(script.includes('clearTimeout(deadline);'));
  assert.ok(script.includes("if ($p.Path -ne 'C:\\\\Apps\\\\Frieve''s\\\\EffeTune.exe') { exit 0 }"));
  assert.ok(script.includes('FromUnixTimeMilliseconds(1700000000000)'));
  assert.ok(script.includes('Stop-Process -Id 4242 -Force'));
  assert.ok(script.indexOf('exit 0') < script.indexOf('Stop-Process'));
  assert.ok(script.includes("'powershell.exe'"));
  assert.deepEqual(armed, { pid: 4242, timeoutSeconds: 30, command, args });
});

test('quit deadline helper matches the executable name before killing on POSIX platforms', () => {
  const calls = [];
  armQuitDeadline({
    pid: 77,
    execPath: '/Applications/EffeTune.app/Contents/MacOS/EffeTune',
    timeoutSeconds: 12.4,
    platform: 'darwin',
    spawn: fakeSpawn(calls),
    logger: { error() {} }
  });

  const script = calls[0].args[1];
  assert.ok(script.includes('const platform = "darwin";'));
  assert.ok(script.includes('}, 12000);'));
  assert.ok(script.includes("spawnSync('ps', ['-o', 'comm=', '-p', String(pid)]"));
  assert.ok(script.includes("process.kill(pid, 'SIGKILL')"));
  assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, '1');
});

test('quit deadline defaults to the current process and the default timeout, never below one second', () => {
  const calls = [];
  const armed = armQuitDeadline({ spawn: fakeSpawn(calls), logger: { error() {} } });
  assert.equal(armed.pid, process.pid);
  assert.equal(armed.command, process.execPath);
  assert.equal(armed.timeoutSeconds, QUIT_DEADLINE_DEFAULT_TIMEOUT_SECONDS);
  const clamped = armQuitDeadline({ timeoutSeconds: 0, spawn: fakeSpawn(calls), logger: { error() {} } });
  assert.equal(clamped.timeoutSeconds, 1);
});

test('quit deadline reports helper start failures instead of throwing during shutdown', () => {
  const errors = [];
  const armed = armQuitDeadline({
    spawn() { const error = new Error('spawn failed'); error.code = 'ENOENT'; throw error; },
    logger: { error(...args) { errors.push(args); } }
  });
  assert.equal(armed, null);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1], 'ENOENT');

  const calls = [];
  armQuitDeadline({ spawn: fakeSpawn(calls), logger: { error(...args) { errors.push(args); } } });
  calls[0].child.handlers.error({ code: 'EACCES' });
  assert.equal(errors.length, 2);
  assert.equal(errors[1][1], 'EACCES');
});

async function waitForExit(child, timeoutMs) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function startIdleChild() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
}

function armForChild(child, overrides = {}) {
  return armQuitDeadline({
    pid: child.pid,
    execPath: process.execPath,
    startedAt: Date.now(),
    timeoutSeconds: 1,
    ...overrides
  });
}

// The kill itself costs a helper process start plus, on Windows, a PowerShell
// start; both stretch far beyond their standalone cost when the whole test
// suite runs its files in parallel. These waits are only ever paid in full
// when the helper is genuinely broken, so they stay generous.
test('quit deadline helper kills a process that outlives its deadline on this platform', async t => {
  const child = startIdleChild();
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(armForChild(child));
  assert.equal(await waitForExit(child, 60000), true);
});

test('quit deadline helper leaves a process alone when the executable path does not match', async t => {
  const child = startIdleChild();
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  await new Promise(resolve => setTimeout(resolve, 200));
  armForChild(child, {
    execPath: process.platform === 'win32' ? 'C:\\nonexistent\\other-app.exe' : '/nonexistent/other-app'
  });
  assert.equal(await waitForExit(child, 4000), false);
  assert.equal(child.exitCode, null);
});

test('quit deadline helper leaves a Windows process alone when its start time does not match', { skip: process.platform !== 'win32' }, async t => {
  const child = startIdleChild();
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  await new Promise(resolve => setTimeout(resolve, 200));
  armForChild(child, { startedAt: Date.now() - 60000 });
  assert.equal(await waitForExit(child, 4000), false);
  assert.equal(child.exitCode, null);
});

test('quit deadline helper outlives the process that armed it', async t => {
  const target = startIdleChild();
  t.after(() => { try { target.kill('SIGKILL'); } catch {} });
  await new Promise(resolve => setTimeout(resolve, 200));
  const armer = spawn(process.execPath, ['-e', [
    "const { armQuitDeadline } = require('./electron/quit-deadline.cjs');",
    `armQuitDeadline({ pid: ${target.pid}, execPath: ${JSON.stringify(process.execPath)}, startedAt: ${Date.now()}, timeoutSeconds: 1 });`,
    'process.exit(0);'
  ].join('\n')], { stdio: 'ignore', cwd: process.cwd() });
  assert.equal(await waitForExit(armer, 30000), true);
  assert.equal(await waitForExit(target, 60000), true);
});
