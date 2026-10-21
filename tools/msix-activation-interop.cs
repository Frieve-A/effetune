using System;
using System.Runtime.InteropServices;
namespace MsixTrial {
  public sealed class ActivationManager : IDisposable {
    internal IActivationManager Interface { get; private set; }
    [DllImport("ole32.dll", PreserveSig=false)]
    static extern void CoCreateInstance(ref Guid clsid, IntPtr outer, uint context, ref Guid iid,
      [MarshalAs(UnmanagedType.Interface)] out IActivationManager manager);
    public ActivationManager() {
      Guid clsid = new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C"), iid = typeof(IActivationManager).GUID;
      IActivationManager manager;
      // A short-lived task uses the local server to preserve activation arguments after it exits.
      CoCreateInstance(ref clsid, IntPtr.Zero, 4, ref iid, out manager);
      Interface = manager;
    }
    public void Dispose() {
      if (Interface != null) { Marshal.ReleaseComObject(Interface); Interface = null; }
    }
  }
  [ComImport, Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IActivationManager {
    void ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.LPWStr)] string args, uint options, out uint pid);
  }
  public static class Native {
    public static uint ActivateApplication(ActivationManager manager, string id, string arguments) {
      uint pid;
      manager.Interface.ActivateApplication(id, arguments, 0, out pid);
      return pid;
    }
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int infoClass, out int info, int size, out int returned);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static bool IsElevated(uint pid) {
      IntPtr process = OpenProcess(0x1000, false, pid), token = IntPtr.Zero;
      try {
        int value, returned;
        if (process == IntPtr.Zero || !OpenProcessToken(process, 8, out token) || !GetTokenInformation(token, 20, out value, 4, out returned))
          throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return value != 0;
      } finally { if (token != IntPtr.Zero) CloseHandle(token); if (process != IntPtr.Zero) CloseHandle(process); }
    }
  }
}
