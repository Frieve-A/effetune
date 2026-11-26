package com.frieve.effetune;

/** Decoder-thread interleaved resampling; one instance per source format/rate. */
final class PcmResampler implements AutoCloseable {
    static { System.loadLibrary("effetune_android"); }
    private long handle;
    PcmResampler(int inputRate, int outputRate) { this(inputRate, outputRate, 2); }
    PcmResampler(int inputRate, int outputRate, int width) { handle = create(inputRate, outputRate, width); }
    /** At most 1024 input frames. end drains the filter and completes this stream. */
    float[] process(float[] pcm, int frames, boolean end) { return process(handle, pcm, frames, end); }
    @Override public void close() { if (handle != 0) { destroy(handle); handle = 0; } }
    private static native long create(int inputRate, int outputRate, int width);
    private static native float[] process(long handle, float[] pcm, int frames, boolean end);
    private static native void destroy(long handle);
}
