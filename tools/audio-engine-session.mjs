import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import engineProtocol from '../electron/audio-engine-protocol.cjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const commandTimeoutMs = 15_000;
const { kinds, encodeFrame, frameReader } = engineProtocol;

export const protocolVersion = engineProtocol.VERSION;
export const maximumFrameBytes = engineProtocol.MAX_FRAME_BYTES;
export const unsupportedCpuExitCode = engineProtocol.UNSUPPORTED_CPU;
export const forceBaselineEnv = 'EFFETUNE_AUDIO_ENGINE_FORCE_BASELINE';
export const requireExecutableEnv = 'EFFETUNE_AUDIO_ENGINE_REQUIRED';

export function executableNames(platform, architecture) {
  const suffix = platform === 'win32' ? '.exe' : '';
  const baseline = `effetune-audio-engine${suffix}`;
  const v3 = architecture === 'x64' ? `effetune-audio-engine-v3${suffix}` : null;
  return { baseline, v3 };
}

export function builtExecutableDirectory(platform = process.platform, architecture = process.arch) {
  return join(root, 'out', 'native', 'audio-engine', `${platform}-${architecture}`);
}

export async function withAudioEngine(executable, args, action, { env = process.env } = {}) {
  const child = spawn(executable, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let processError;
  let diagnostics = '';
  child.on('error', error => { processError = error; });
  child.stdin.on('error', () => {});
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-8192); });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const readFrame = frameReader(child.stdout);
  const session = {
    readFrame,
    async receive(type, predicate = () => true) {
      let frame = await readFrame();
      while (frame !== null) {
        if (frame.kind === kinds.control && frame.message.type === type && predicate(frame.message)) return frame;
        frame = await readFrame();
      }
      throw processError ?? new Error(`The audio engine exited before sending ${type}. ${diagnostics}`.trim());
    },
    write(bytes) {
      return new Promise((resolve, reject) => {
        child.stdin.write(bytes, error => error ? reject(error) : resolve());
      });
    },
    send(message, attachment) {
      return this.write(encodeFrame(kinds.control, message, attachment));
    },
    async finish() {
      child.stdin.end();
      // The frame iterator owns stdout, including packets sent after the last reply.
      while (await readFrame() !== null) { /* Drain final protocol messages. */ }
      const result = await closed;
      if (processError) throw processError;
      return { ...result, diagnostics };
    },
  };

  let timeout;
  try {
    return await Promise.race([
      action(session),
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`The audio engine timed out. ${diagnostics}`.trim())),
          commandTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    child.stdout.destroy();
    let cleanupTimeout;
    try {
      await Promise.race([
        closed,
        new Promise((resolve, reject) => {
          cleanupTimeout = setTimeout(() => reject(new Error('Could not stop the audio engine process.')), 2000);
        }),
      ]);
    } finally {
      clearTimeout(cleanupTimeout);
    }
  }
}
