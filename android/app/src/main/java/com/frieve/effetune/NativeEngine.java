package com.frieve.effetune;

/** Service-owned native audio engine. Control calls must use one executor. */
public final class NativeEngine implements AutoCloseable {
    static { System.loadLibrary("effetune_android"); }
    private long handle;
    public NativeEngine(int sampleRate, int maxFrames) { handle = create(sampleRate, maxFrames); }
    public int start() { return start(handle); }
    /** Control-owner reconciliation: 1 running, 0 stopped, negative Oboe error. */
    public int getOutputStatus() { return outputStatus(handle); }
    public int getInputSessionId() { return inputSessionId(handle); }
    public void stop() { stop(handle); }
    public void prepareResume() { prepareResume(handle); }
    @Override public void close() { if (handle != 0) { destroy(handle); handle = 0; } }
    public int getSampleRate() { return sampleRate(handle); }
    public int getOutputDeviceId() { return outputDeviceId(handle); }
    public int setOutputDevice(int deviceId) { return outputDevice(handle, deviceId); }
    public void setMeasurementNoiseFile(int fd, int frames) { measurementNoiseFile(handle, fd, frames); }
    public void stopMeasurementNoise() { stopMeasurementNoise(handle); }
    public int setInputDevice(int deviceId) { return inputDevice(handle, deviceId); }
    public int[] configurePipeline(String[] types, float[][] parameters, int[] hashes, byte[] descriptor, byte[][] structured) {
        return configure(handle, types, parameters, hashes, descriptor, structured);
    }
    public int setParameters(int instance, float[] values, int hash) { return parameters(handle, instance, values, hash); }
    public int setParameterBytes(int instance, byte[] values, int hash) { return parameterBytes(handle, instance, values, hash); }
    public int setAsset(int instance, int slot, int[] info, byte[] bytes, int format) {
        return asset(handle, instance, slot, info, bytes, format);
    }
    public int setAssetFile(int instance, int slot, int[] info, int fd, long byteSize, int format) {
        return assetFile(handle, instance, slot, info, fd, byteSize, format);
    }
    public int clearAsset(int instance, int slot) { return setAsset(instance, slot, new int[10], new byte[0], 0); }
    public byte[] readTelemetry() { return telemetry(handle); }
    /** Repeated instance handle, generation, latched flag, cause code. */
    public int[] readRuntimeEvents() { return runtimeEvents(handle); }
    public void setMasterBypass(boolean value) { bypass(handle, value); }
    public long beginSource() { return beginSource(handle); }
    public int writePcm(float[] data, int frames, long generation) { return writePcm(handle, data, frames, generation); }
    public int getQueuedFrames() { return queuedFrames(handle); }
    public long getRenderedFrames() { return renderedFrames(handle); }
    public void setPlaying(boolean value) { playing(handle, value); }
    public void setGain(float value) { gain(handle, value); }
    public void setPlayerGain(float value) { playerGain(handle, value); }
    public void beginMeasurementFiles(int excitationFd, int resultFd, int excitationFrames, int captureFrames) {
        beginMeasurementFiles(handle, excitationFd, resultFd, excitationFrames, captureFrames);
    }
    public void cancelMeasurement() { cancelMeasurement(handle); }
    public int[] getMeasurementState() { return measurementState(handle); }
    public void setPowerSettings(float threshold, float monitoringSeconds, boolean mustProcess) {
        powerSettings(handle, threshold, monitoringSeconds, mustProcess);
    }
    /** Sequence, input peak, output peak, silent seconds, monitoring flag. */
    public float[] getPowerObservation() { return powerObservation(handle); }
    public long getAudioFrameTime() { return audioFrameTime(handle); }
    public int scheduleParameters(int instance, float[] values, int hash, long frame) {
        return scheduleParameters(handle, instance, values, hash, frame);
    }
    private static native long create(int sampleRate, int maxFrames);
    private static native void destroy(long handle);
    private static native int start(long handle);
    private static native int outputStatus(long handle);
    private static native int inputSessionId(long handle);
    private static native void stop(long handle);
    private static native void prepareResume(long handle);
    private static native int sampleRate(long handle);
    private static native int outputDeviceId(long handle);
    private static native int outputDevice(long handle, int deviceId);
    private static native void measurementNoiseFile(long handle, int fd, int frames);
    private static native void stopMeasurementNoise(long handle);
    private static native int inputDevice(long handle, int deviceId);
    private static native int[] configure(long handle, String[] types, float[][] parameters, int[] hashes, byte[] descriptor, byte[][] structured);
    private static native int parameters(long handle, int instance, float[] values, int hash);
    private static native int parameterBytes(long handle, int instance, byte[] values, int hash);
    private static native int asset(long handle, int instance, int slot, int[] info, byte[] bytes, int format);
    private static native int assetFile(long handle, int instance, int slot, int[] info, int fd, long byteSize, int format);
    private static native byte[] telemetry(long handle);
    private static native int[] runtimeEvents(long handle);
    private static native void bypass(long handle, boolean value);
    private static native long beginSource(long handle);
    private static native int writePcm(long handle, float[] data, int frames, long generation);
    private static native int queuedFrames(long handle);
    private static native long renderedFrames(long handle);
    private static native void playing(long handle, boolean value);
    private static native void gain(long handle, float value);
    private static native void playerGain(long handle, float value);
    private static native void beginMeasurementFiles(long handle, int excitationFd, int resultFd, int excitationFrames, int captureFrames);
    private static native void cancelMeasurement(long handle);
    private static native int[] measurementState(long handle);
    private static native void powerSettings(long handle, float threshold, float monitoringSeconds, boolean mustProcess);
    private static native float[] powerObservation(long handle);
    private static native long audioFrameTime(long handle);
    private static native int scheduleParameters(long handle, int instance, float[] values, int hash, long frame);
}
