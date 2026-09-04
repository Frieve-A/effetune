const { spawn: defaultSpawn } = require('child_process');

// How long a quitting EffeTune process may keep running before it is killed
// from the outside. Chromium's shutdown can block inside a third-party driver
// (a modal raised by a MIDI synthesizer during MIDI teardown, for example).
// A process stuck like that still holds the browser storage lock files, so a
// relaunched or newly started EffeTune cannot open its IR library or
// measurement database. JavaScript timers cannot fire from a blocked main
// thread, so the deadline lives in a detached helper process that verifies it
// is still looking at the same EffeTune process before killing it.
//
// The helper is this executable running as plain Node (ELECTRON_RUN_AS_NODE),
// which keeps the app free of extra runtime dependencies. Console hosts such as
// powershell.exe cannot serve as the detached helper themselves: a process
// created with DETACHED_PROCESS has no console and PowerShell then exits
// without running anything, while a non-detached child dies with its parent's
// job object. The Node helper has neither problem and runs PowerShell as an
// ordinary hidden child when it needs Windows process details.
//
// NOTE: this relies on the Electron `runAsNode` fuse staying enabled.
const DEFAULT_TIMEOUT_SECONDS = 30;
const START_TIME_TOLERANCE_SECONDS = 5;

function escapePowerShellLiteral(value) {
  return String(value).replace(/'/g, "''");
}

// Verifies the process id, executable path and start time before killing, so
// a recycled process id (possibly a freshly relaunched EffeTune) is never
// killed by mistake.
function powerShellCommand({ pid, execPath, startedAt }) {
  return [
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    'if ($null -eq $p) { exit 0 }',
    `if ($p.Path -ne '${escapePowerShellLiteral(execPath)}') { exit 0 }`,
    `$expected = [DateTimeOffset]::FromUnixTimeMilliseconds(${startedAt}).LocalDateTime`,
    `if ([Math]::Abs(($p.StartTime - $expected).TotalSeconds) -gt ${START_TIME_TOLERANCE_SECONDS}) { exit 0 }`,
    `Stop-Process -Id ${pid} -Force`
  ].join('; ');
}

// Source of the helper process. Everything is embedded as literals so the
// helper needs no files besides the runtime itself.
function helperSource({ pid, execPath, startedAt, timeoutSeconds, platform }) {
  return [
    "const { spawnSync } = require('child_process');",
    "const path = require('path');",
    `const pid = ${pid};`,
    `const execPath = ${JSON.stringify(String(execPath))};`,
    `const platform = ${JSON.stringify(platform)};`,
    `const windowsCheck = ${JSON.stringify(powerShellCommand({ pid, execPath, startedAt }))};`,
    "const alive = () => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };",
    'const deadline = setTimeout(() => {',
    '  clearInterval(poll);',
    '  if (!alive()) return;',
    "  if (platform === 'win32') {",
    "    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', windowsCheck],",
    "      { stdio: 'ignore', windowsHide: true, timeout: 60000 });",
    '    return;',
    '  }',
    "  const result = spawnSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8', timeout: 10000 });",
    "  const name = String(result.stdout || '').trim();",
    '  if (!name || !name.endsWith(path.basename(execPath))) return;',
    "  try { process.kill(pid, 'SIGKILL'); } catch {}",
    `}, ${timeoutSeconds * 1000});`,
    'const poll = setInterval(() => {',
    '  if (alive()) return;',
    '  clearInterval(poll);',
    '  clearTimeout(deadline);',
    '}, 100);'
  ].join('\n');
}

/**
 * Starts the detached helper that force-kills this process if it is still
 * alive after the deadline. Returns a description of what was spawned, or
 * null when nothing could be started.
 */
function armQuitDeadline(options = {}) {
  const pid = options.pid ?? process.pid;
  const execPath = options.execPath ?? process.execPath;
  const helperExecPath = options.helperExecPath ?? process.execPath;
  const startedAt = options.startedAt ?? Math.round(Date.now() - process.uptime() * 1000);
  const timeoutSeconds = Math.max(1, Math.round(options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS));
  const platform = options.platform ?? process.platform;
  const spawn = options.spawn ?? defaultSpawn;
  const logger = options.logger ?? console;
  const env = { ...(options.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' };

  const command = helperExecPath;
  const args = ['-e', helperSource({ pid, execPath, startedAt, timeoutSeconds, platform })];
  try {
    // A new session / DETACHED_PROCESS keeps the helper out of this process's
    // group and job object, so neither shutdown signals nor the parent's exit
    // take the helper with them.
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, env });
    child.on?.('error', error => {
      logger.error?.('Quit deadline helper failed:', error?.code || error?.message || 'unknown');
    });
    child.unref?.();
    return { pid, timeoutSeconds, command, args };
  } catch (error) {
    logger.error?.('Quit deadline helper could not start:', error?.code || error?.message || 'unknown');
    return null;
  }
}

module.exports = {
  QUIT_DEADLINE_DEFAULT_TIMEOUT_SECONDS: DEFAULT_TIMEOUT_SECONDS,
  armQuitDeadline
};
