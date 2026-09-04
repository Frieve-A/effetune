const defaultFs = require('fs');
const path = require('path');

// Each running EffeTune process records itself under userData/instances so a
// newly started process can tell whether a predecessor is still shutting down.
// Chromium releases the single-instance lock early in its shutdown, long
// before the browser storage lock files are closed, so without this record a
// new process could start against a storage layer that is still held by the
// previous one and fail to open its databases. Records are never removed by
// their owner (a process blocked in shutdown could not do so anyway); each
// process removes records of processes that no longer exist.
const REGISTRY_DIRECTORY = 'instances';
const RECORD_PATTERN = /^([0-9]{1,10})\.json$/;

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createInstanceRegistry(options = {}) {
  const fs = options.fs ?? defaultFs;
  const now = options.now ?? Date.now;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const sleep = options.sleep ?? defaultSleep;
  const pid = options.pid ?? process.pid;
  const logger = options.logger ?? console;
  if (typeof options.userDataPath !== 'string' || options.userDataPath.length === 0) {
    throw new TypeError('An instance registry needs the user data path.');
  }
  const directory = path.join(options.userDataPath, REGISTRY_DIRECTORY);
  const ownPath = path.join(directory, `${pid}.json`);
  let record = null;

  function writeRecord(next) {
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = `${ownPath}.${now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(next));
    fs.renameSync(tempPath, ownPath);
    record = next;
  }

  function readRecord(name) {
    const match = RECORD_PATTERN.exec(name);
    if (!match) return null;
    const recordPid = Number(match[1]);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    } catch {
      parsed = {};
    }
    return {
      pid: recordPid,
      startedAt: Number.isFinite(parsed?.startedAt) ? parsed.startedAt : null,
      quittingAt: Number.isFinite(parsed?.quittingAt) ? parsed.quittingAt : null
    };
  }

  function removeRecord(name) {
    try {
      fs.unlinkSync(path.join(directory, name));
    } catch {
      // Another instance may have removed it first.
    }
  }

  return {
    directory,

    register() {
      writeRecord({ pid, startedAt: now() });
      return record;
    },

    markQuitting() {
      writeRecord({ ...(record || { pid, startedAt: now() }), quittingAt: now() });
      return record;
    },

    /**
     * Lists other EffeTune processes that are still alive. Records of dead
     * processes are removed on the way. Entries carry `quittingAt` when the
     * owner has entered its quit sequence.
     */
    findOtherInstances() {
      let names;
      try {
        names = fs.readdirSync(directory);
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
      const alive = [];
      for (const name of names) {
        const entry = readRecord(name);
        if (!entry || entry.pid === pid) continue;
        if (!isProcessAlive(entry.pid)) {
          removeRecord(name);
          continue;
        }
        alive.push(entry);
      }
      return alive;
    },

    /**
     * Waits while a predecessor that has started quitting is still alive.
     * The wait is bounded by `timeoutMs` measured from the predecessor's
     * `quittingAt`, which matches the quit deadline that force-kills it.
     * Processes that never entered their quit sequence are not waited for:
     * they are either a recycled process id or an instance the watchdog owns.
     */
    async waitForQuittingPredecessors({ timeoutMs, pollMs = 250 } = {}) {
      const startedWaiting = now();
      const limit = Number.isFinite(timeoutMs) ? timeoutMs : 0;
      for (;;) {
        const blocking = this.findOtherInstances().filter(entry =>
          entry.quittingAt !== null && now() - entry.quittingAt < limit);
        if (blocking.length === 0) {
          return { waitedMs: now() - startedWaiting, remaining: [] };
        }
        if (now() - startedWaiting >= limit) {
          logger.warn?.(
            `[instances] gave up waiting for quitting predecessor(s) ${blocking.map(entry => entry.pid).join(', ')}`
          );
          return { waitedMs: now() - startedWaiting, remaining: blocking };
        }
        await sleep(pollMs);
      }
    }
  };
}

module.exports = {
  INSTANCE_REGISTRY_DIRECTORY: REGISTRY_DIRECTORY,
  createInstanceRegistry
};
