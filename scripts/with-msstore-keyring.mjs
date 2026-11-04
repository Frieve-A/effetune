import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function withStoreKeyring(action, signal) {
  if (process.platform !== 'linux' || !process.env.DBUS_SESSION_BUS_ADDRESS) {
    throw new Error('Run Store submission inside a private Linux dbus-run-session.');
  }
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-store-keyring-')));
  let daemon;
  let closed;
  let stopped = false;
  let failure;
  let result;
  try {
    await fs.chmod(temporary, 0o700);
    const env = { ...process.env };
    for (const [name, directory] of Object.entries({
      HOME: 'home', XDG_DATA_HOME: 'data', XDG_CONFIG_HOME: 'config',
      XDG_RUNTIME_DIR: 'runtime', GNOME_KEYRING_CONTROL: 'control'
    })) {
      env[name] = path.join(temporary, directory);
      await fs.mkdir(env[name], { mode: 0o700 });
    }
    daemon = spawn('gnome-keyring-daemon', [
      '--foreground', '--components=secrets', '--unlock',
      `--control-directory=${env.GNOME_KEYRING_CONTROL}`
    ], { env, stdio: ['pipe', 'ignore', 'ignore'] });
    let startupFailed = false;
    daemon.on('error', () => { startupFailed = true; });
    daemon.stdin.on('error', () => { startupFailed = true; });
    closed = new Promise(resolve => daemon.once('close', () => { stopped = true; resolve(); }));
    daemon.stdin.end(`${randomBytes(32).toString('hex')}\n`);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      signal?.throwIfAborted();
      if (startupFailed || stopped) break;
      const { stdout } = await execute('dbus-send', [
        '--session', '--dest=org.freedesktop.DBus', '--print-reply',
        '/org/freedesktop/DBus', 'org.freedesktop.DBus.NameHasOwner',
        'string:org.freedesktop.secrets'
      ], { env, timeout: 1000, signal });
      if (/boolean true\b/.test(stdout)) { ready = true; break; }
      await delay(100, undefined, { signal });
    }
    if (!ready) throw new Error('The private Store credential service could not start.');
    result = await action(env);
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (daemon && !stopped) {
        daemon.kill('SIGTERM');
        await Promise.race([closed, delay(3000)]);
        if (!stopped) {
          daemon.kill('SIGKILL');
          await Promise.race([closed, delay(3000)]);
          if (!stopped) failure ||= new Error('The private credential service did not stop.');
        }
      }
      await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Preserve the submission failure when credential cleanup also fails.
      failure ||= new Error('The temporary Store credential environment could not be removed.');
    }
  }
  if (failure) throw failure;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  withStoreKeyring(env => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./publish-msstore.mjs', import.meta.url)), '--submit'],
      { env, stdio: 'inherit', signal: controller.signal });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Store submission did not complete.')));
  }), controller.signal).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  }).finally(() => {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  });
}
