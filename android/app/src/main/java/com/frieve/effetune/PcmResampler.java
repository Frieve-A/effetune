package com.frieve.effetune;

/** Decoder-thread stereo resampling; one instance per source format/rate. */
final class PcmResampler implements AutoCloseable {
    static { System.loadLibrary("effetune_android"); }
    private long handle;
    PcmResampler(int inputRate, int outputRate) { handle = create(inputRate, outputRate); }
    /** At most 1024 input frames. end drains the filter and completes this stream. */
    float[] process(float[] stereo, int frames, boolean end) { return process(handle, stereo, frames, end); }
    @Override public void close() { if (handle != 0) { destroy(handle); handle = 0; } }
    private static native long create(int inputRate, int outputRate);
    private static native float[] process(long handle, float[] stereo, int frames, boolean end);
    private static native void destroy(long handle);
}
