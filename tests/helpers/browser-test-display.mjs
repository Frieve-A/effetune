import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fitTestWindow } from './electron-test-display.cjs';

let displayPromise;

function getTestDisplay() {
  displayPromise ??= import('electron').then(({ default: electronPath }) => new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    // This trusted probe reads native display geometry without creating a renderer.
    const child = fork(fileURLToPath(new URL('./test-display-probe.cjs', import.meta.url)), [], {
      execPath: electronPath, execArgv: process.platform === 'linux' ? ['--no-sandbox'] : [],
      env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    let display;
    let diagnostics = '';
    const guard = setTimeout(() => {
      child.kill();
      reject(new Error('Test display discovery timed out.'));
    }, 15_000);
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
    child.on('message', message => { display = message; });
    child.once('error', error => { clearTimeout(guard); reject(error); });
    child.once('exit', code => {
      clearTimeout(guard);
      if (code === 0 && display?.workArea) resolve(display);
      else reject(new Error(`Test display discovery failed (${code}): ${diagnostics}`));
    });
  }));
  return displayPromise;
}

export async function browserTestLaunchOptions({ headless = true, args = [], ...options } = {}) {
  if (headless) return { ...options, headless, args };
  const display = await getTestDisplay();
  const bounds = fitTestWindow({ width: 1280, height: 900 }, display.workArea);
  return { ...options, headless, args: [...args,
    `--window-position=${bounds.x},${bounds.y}`, `--window-size=${bounds.width},${bounds.height}`] };
}
