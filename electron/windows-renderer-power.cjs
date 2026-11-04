const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

function createWindowsRendererPower({ helperPath, getConfig, getRendererWebContents,
  spawnProcess = spawn, onDiagnostic = () => {} }) {
  let child = null;
  let reportedActive = false;
  let closed = false;
  let failedPid = null;
  let queue = Promise.resolve();
  let recovery = Promise.resolve();
  let lastStatus = { applied: false, pid: null };

  function targetPid() {
    const contents = getRendererWebContents();
    if (!contents || contents.isDestroyed?.()) return null;
    const pid = contents.getOSProcessId?.();
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  }

  function shouldApply() {
    if (closed || !reportedActive || getConfig()?.powerSaving?.mode !== 'continuous') return null;
    const pid = targetPid();
    return pid === failedPid ? null : pid;
  }

  async function restoreAfterExit(entry, exit) {
    let result = entry.restoredStatus;
    if (result?.event !== 'terminated' &&
        !(exit.code === 0 && result?.event === 'restored' && result.matched === true)) {
      const saved = entry.status;
      const fallback = spawnProcess(helperPath, ['--restore', String(entry.pid),
        saved.creationTime, String(saved.originalControl & 1), String(saved.originalState & 1)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      fallback.stdout.on('data', bytes => { output = (output + bytes).slice(-2048); });
      const fallbackExit = await new Promise((resolve, reject) => {
        fallback.once('error', reject);
        fallback.once('close', (code, signal) => resolve({ code, signal }));
      });
      result = output.trim().split(/\r?\n/).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).findLast(message => message?.event === 'restored' || message?.event === 'terminated');
      if (fallbackExit.code !== 0 || !result ||
          (result.event === 'restored' && result.matched !== true)) {
        if (!child || child.pid === entry.pid) {
          lastStatus = { applied: false, pid: entry.pid, restoreFailed: true };
        }
        onDiagnostic('Renderer power helper fallback restore failed.', fallbackExit);
        return;
      }
    }
    if (child && child.pid !== entry.pid) return;
    lastStatus = { applied: false, pid: entry.pid,
      creationTime: entry.status?.creationTime ?? null,
      ...(result?.event === 'restored'
        ? { controlMask: result.controlMask, stateMask: result.stateMask,
          restored: result.matched === true }
        : { terminated: true }),
      helperExitCode: exit.code };
  }

  function start(pid) {
    return new Promise((resolve, reject) => {
      const process = spawnProcess(helperPath, [String(pid)], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
      });
      const entry = { pid, process, applied: false, stopping: false, exit: null };
      const lines = createInterface({ input: process.stdout });
      lines.on('line', line => {
        try {
          const message = JSON.parse(line);
          if (message.event === 'restored' || message.event === 'terminated') {
            entry.restoredStatus = message;
          }
        } catch { /* The first-line handler reports invalid startup data. */ }
      });
      entry.exit = new Promise(exitResolve => process.once('close', (code, signal) => {
        lines.close();
        if (!entry.applied) reject(new Error('Renderer power helper exited before confirming policy.'));
        if (child === entry) {
          child = null;
          failedPid = entry.pid;
          lastStatus = { applied: false, pid: entry.pid, restoring: true };
          recovery = restoreAfterExit(entry, { code, signal }).catch(error => {
            if (!child || child.pid === entry.pid) {
              lastStatus = { applied: false, pid: entry.pid, restoreFailed: true };
            }
            onDiagnostic('Renderer power helper recovery failed.', error);
          });
        }
        exitResolve({ code, signal });
      }));
      process.once('error', reject);
      lines.once('line', line => {
        let result;
        try { result = JSON.parse(line); } catch (error) {
          process.stdin.end('restore\n');
          reject(error);
          return;
        }
        if (result.event !== 'applied' || result.pid !== pid ||
            (result.controlMask & 1) !== 1 || (result.stateMask & 1) !== 0 ||
            typeof result.creationTime !== 'string') {
          process.stdin.end('restore\n');
          reject(new Error('Renderer power helper did not confirm the requested policy.'));
          return;
        }
        entry.applied = true;
        entry.status = result;
        child = entry;
        lastStatus = { applied: true, pid, helperPid: process.pid,
          creationTime: result.creationTime,
          originalControl: result.originalControl, originalState: result.originalState,
          controlMask: result.controlMask, stateMask: result.stateMask };
        resolve(entry);
      });
    });
  }

  async function stopCurrent() {
    const entry = child;
    if (!entry) return;
    child = null;
    lastStatus = { ...lastStatus, restoring: true };
    if (!entry.stopping) {
      entry.stopping = true;
      entry.process.stdin.end('restore\n');
    }
    const result = await entry.exit;
    await restoreAfterExit(entry, result);
    if (result.code !== 0) onDiagnostic('Renderer power helper restore failed.', result);
  }

  async function reconcile() {
    await recovery;
    const pid = shouldApply();
    if (child?.pid === pid) return;
    await stopCurrent();
    if (pid === null || shouldApply() !== pid) return;
    try {
      await start(pid);
      if (shouldApply() !== pid) await stopCurrent();
    } catch (error) {
      lastStatus = { applied: false, pid: null, error: error.code || error.message };
      onDiagnostic('Renderer power helper could not apply HighQoS.', error);
    }
  }

  function schedule() {
    queue = queue.then(reconcile, reconcile).catch(error => {
      onDiagnostic('Renderer power helper lifecycle failed.', error);
    });
    return queue;
  }

  function update(active) {
    reportedActive = active === true;
    if (!reportedActive) failedPid = null;
    return schedule();
  }

  function refreshConfig() {
    if (getConfig()?.powerSaving?.mode !== 'continuous') failedPid = null;
    return schedule();
  }
  function stop() { reportedActive = false; return schedule(); }
  function dispose() {
    closed = true;
    reportedActive = false;
    if (child && !child.stopping) {
      child.stopping = true;
      child.process.stdin.end('restore\n');
    }
    return schedule();
  }
  function status() { return { ...lastStatus, processingActive: reportedActive }; }
  return { update, refreshConfig, stop, dispose, status };
}

module.exports = { createWindowsRendererPower };
