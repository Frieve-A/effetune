const { spawn: defaultSpawn } = require('child_process');

// Keeps the Windows default output muted while System Audio is captured.
//
// Chromium's `loopbackWithMute` mutes the default render endpoint once when a
// capture starts and unmutes it when that capture stops, but it does not watch
// the endpoint in between. Raising the volume with the Windows volume keys or
// flyout unmutes the endpoint, so the original sound would play twice: once
// directly and once through EffeTune. This hidden PowerShell helper watches
// that endpoint and mutes it again whenever it is unmuted during a capture.
//
// Protocol: the helper prints `ready <0|1>` with the mute state it found before
// any capture starts, `keep` starts holding the mute, and `restore` (or stdin
// closing) puts back that original state and exits.

// Stays well inside the renderer's 5-second capture timeout. A capture whose
// helper is late starts anyway, without the kept mute.
const READY_TIMEOUT_MS = 3000;

const HELPER_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  void EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  void GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  void Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}

[ComImport, Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolumeCallback {
  [PreserveSig] int OnNotify(IntPtr data);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  void RegisterControlChangeNotify(IAudioEndpointVolumeCallback callback);
  void UnregisterControlChangeNotify(IAudioEndpointVolumeCallback callback);
  void GetChannelCount(out uint count);
  void SetMasterVolumeLevel(float level, ref Guid context);
  void SetMasterVolumeLevelScalar(float level, ref Guid context);
  void GetMasterVolumeLevel(out float level);
  void GetMasterVolumeLevelScalar(out float level);
  void SetChannelVolumeLevel(uint channel, float level, ref Guid context);
  void SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
  void GetChannelVolumeLevel(uint channel, out float level);
  void GetChannelVolumeLevelScalar(uint channel, out float level);
  void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
  void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

public class EffeTuneMuteKeeper : IAudioEndpointVolumeCallback {
  static Guid context = Guid.NewGuid();
  readonly IAudioEndpointVolume volume;
  readonly object gate = new object();
  bool keeping;
  public readonly bool WasMuted;

  public EffeTuneMuteKeeper() {
    var enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
    IMMDevice device;
    // eRender / eConsole: the endpoint Chromium's loopbackWithMute captures and mutes.
    enumerator.GetDefaultAudioEndpoint(0, 0, out device);
    var iid = typeof(IAudioEndpointVolume).GUID;
    object activated;
    device.Activate(ref iid, 23, IntPtr.Zero, out activated);
    volume = (IAudioEndpointVolume)activated;
    volume.GetMute(out WasMuted);
    volume.RegisterControlChangeNotify(this);
  }

  void MuteIfKeeping() {
    lock (gate) {
      if (keeping) volume.SetMute(true, ref context);
    }
  }

  public void Keep() {
    lock (gate) keeping = true;
    MuteIfKeeping();
  }

  public void Restore() {
    lock (gate) {
      if (!keeping) return;
      keeping = false;
      volume.SetMute(WasMuted, ref context);
    }
  }

  public void Close() {
    volume.UnregisterControlChangeNotify(this);
  }

  public int OnNotify(IntPtr data) {
    // AUDIO_VOLUME_NOTIFICATION_DATA: a GUID followed by the BOOL bMuted.
    bool muted = Marshal.ReadInt32(data, 16) != 0;
    // The notification thread must not block, so mute again from the pool.
    if (!muted) ThreadPool.QueueUserWorkItem(_ => { try { MuteIfKeeping(); } catch { } });
    return 0;
  }
}
`;

const HELPER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  `Add-Type -TypeDefinition @'\n${HELPER_SOURCE}\n'@`,
  '$keeper = New-Object EffeTuneMuteKeeper',
  "[Console]::Out.WriteLine('ready ' + [int]$keeper.WasMuted)",
  'while ($null -ne ($line = [Console]::In.ReadLine())) {',
  "  if ($line -eq 'keep') { $keeper.Keep() } elseif ($line -eq 'restore') { break }",
  '}',
  '$keeper.Restore()',
  '$keeper.Close()'
].join('\n');

function encodePowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * Holds the default output mute for as many System Audio captures as are
 * active. `prepare()` must finish before Chromium starts a capture so the
 * helper sees the user's own mute state, not the one the capture applies.
 */
function createSystemAudioMuteKeeper({ spawn = defaultSpawn, logger = console } = {}) {
  let helper = null;
  let holds = 0;
  let disposed = false;

  function stopHelper(current) {
    if (helper === current) helper = null;
    current.cancelStartup?.();
    try { current.child.kill(); } catch { /* already exited */ }
  }

  function startHelper() {
    let child;
    try {
      child = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encodePowerShell(HELPER_SCRIPT)
      ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch (error) {
      logger.error?.('System Audio mute keeper could not start:', error?.code || error?.message || 'unknown');
      return;
    }

    const current = helper = { child };
    current.startup = new Promise(resolve => {
      let output = '';
      const onData = chunk => {
        output += chunk;
        if (/^ready [01]\r?\n/.test(output)) settle();
      };
      const settle = () => {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        current.startup = null;
        current.cancelStartup = null;
        resolve();
      };
      const fail = () => {
        if (!current.cancelStartup) return;
        logger.error?.('System Audio mute keeper is unavailable.');
        stopHelper(current);
      };
      const timer = setTimeout(fail, READY_TIMEOUT_MS);
      current.cancelStartup = settle;
      child.on('error', fail);
      child.on('exit', () => {
        fail();
        if (helper === current) helper = null;
      });
      child.stdin.on('error', () => { /* the helper exited; nothing to restore */ });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', onData);
    });
    return current.startup;
  }

  // Starts a fresh helper unless a capture is already held: while one is,
  // the endpoint is muted by EffeTune and the original state is already known.
  async function prepare() {
    if (disposed) return;
    if (helper?.startup) return helper.startup;
    if (holds > 0 && helper) return;
    if (helper) stopHelper(helper);
    return startHelper();
  }

  function send(command) {
    try { helper?.child.stdin.write(`${command}\n`); } catch { /* the helper exited */ }
  }

  function hold() {
    if (disposed) return;
    holds++;
    if (holds === 1 && !helper?.startup) send('keep');
  }

  function release() {
    if (holds === 0) return;
    holds--;
    if (holds > 0 || !helper || helper.startup) return;
    send('restore');
    helper.child.stdin.end();
    helper = null;
  }

  // Captures ended without their releases (renderer reload or crash).
  function reset() {
    if (helper && (helper.startup || holds === 0)) stopHelper(helper);
    if (holds === 0) return;
    holds = 1;
    release();
  }

  function dispose() {
    disposed = true;
    reset();
  }

  return { prepare, hold, release, reset, dispose };
}

module.exports = { createSystemAudioMuteKeeper };
