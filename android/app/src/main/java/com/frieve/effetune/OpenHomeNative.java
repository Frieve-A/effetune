package com.frieve.effetune;

/**
 * In-process OpenHome / UPnP AV renderer (ohNet plus the desktop sidecar providers).
 * It speaks the sidecar's newline-delimited JSON protocol over a pipe pair. Only one
 * renderer can run per process because ohNet keeps process-wide state.
 */
final class OpenHomeNative {
  static {
    System.loadLibrary("effetune_openhome");
  }

  private OpenHomeNative() {}

  /**
   * Starts the renderer on a native thread. Native code takes ownership of both
   * descriptors (pass {@code ParcelFileDescriptor.detachFd()}), also when it returns
   * false because a renderer is already running. The renderer closes them when it
   * ends, so the Java reader sees end-of-stream; call {@link #nativeStop()} before
   * the next start even then.
   *
   * @param readFd descriptor the renderer reads protocol requests from
   * @param writeFd descriptor the renderer writes protocol messages to
   */
  static native boolean nativeStart(int readFd, int writeFd);

  /** Stops the renderer if one is running and waits until ohNet has shut down. */
  static native void nativeStop();
}
